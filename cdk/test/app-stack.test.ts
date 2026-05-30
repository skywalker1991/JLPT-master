import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AppStack } from '../lib/app-stack';

describe('AppStack', () => {
  const app = new cdk.App({
    context: {
      // Required by Vpc.fromLookup in tests
      'availability-zones:account=123456789012:region=ap-northeast-1': ['ap-northeast-1a', 'ap-northeast-1c'],
      'vpc-provider:account=123456789012:region=ap-northeast-1:filter.isDefault=true:returnAsymmetricSubnets=true': {
        vpcId: 'vpc-12345',
        vpcCidrBlock: '172.31.0.0/16',
        subnetGroups: [
          {
            type: 'Public',
            name: 'Public',
            subnets: [{ subnetId: 'subnet-1', cidr: '172.31.0.0/20', availabilityZone: 'ap-northeast-1a', routeTableId: 'rtb-1' }],
          },
        ],
      },
    },
  });

  const helperStack = new cdk.Stack(app, 'HelperStack', {
    env: { account: '123456789012', region: 'ap-northeast-1' },
  });
  const deployRole = new iam.Role(helperStack, 'MockDeployRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  });

  const stack = new AppStack(app, 'TestAppStack', {
    env: { account: '123456789012', region: 'ap-northeast-1' },
    githubOrg: 'testorg',
    githubRepo: 'JLPT-master',
    deployRole,
  });
  const template = Template.fromStack(stack);

  test('creates EC2 instance with t3.small', () => {
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't3.small',
    });
  });

  test('creates Elastic IP', () => {
    template.resourceCountIs('AWS::EC2::EIP', 1);
  });

  test('creates EIP association', () => {
    template.resourceCountIs('AWS::EC2::EIPAssociation', 1);
  });

  test('security group allows HTTP inbound', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          FromPort: 80,
          ToPort: 80,
          IpProtocol: 'tcp',
          CidrIp: '0.0.0.0/0',
        }),
      ]),
    });
  });

  test('instance role has SSM managed policy', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([Match.stringLikeRegexp('AmazonSSMManagedInstanceCore')]),
          ]),
        }),
      ]),
    });
  });

  test('outputs InstanceId and ElasticIp', () => {
    template.hasOutput('InstanceId', {});
    template.hasOutput('ElasticIp', {});
  });
});
