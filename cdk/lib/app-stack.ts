import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface AppStackProps extends cdk.StackProps {
  githubOrg: string;
  githubRepo: string;
  deployRole: iam.Role;
}

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const { githubOrg, githubRepo, deployRole } = props;

    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // Security group: HTTP inbound only, SSM uses HTTPS outbound (covered by allowAllOutbound)
    const sg = new ec2.SecurityGroup(this, 'AppSg', {
      vpc,
      description: 'JLPT app - HTTP inbound, SSM outbound',
      allowAllOutbound: true,
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');

    // EC2 instance role: SSM access only
    const instanceRole = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // User data: install Docker + Compose, clone repo, start services
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'dnf update -y',
      'dnf install -y docker git',
      'systemctl enable --now docker',
      // Docker Compose v2 plugin
      'mkdir -p /usr/local/lib/docker/cli-plugins',
      'curl -SL https://github.com/docker/compose/releases/download/v2.29.2/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose',
      'chmod +x /usr/local/lib/docker/cli-plugins/docker-compose',
      // Clone repo
      `git clone https://github.com/${githubOrg}/${githubRepo}.git /opt/app`,
      // .env must be placed manually before running docker compose
      'echo "Bootstrap complete. Place /opt/app/.env then run: cd /opt/app && docker compose up --build -d"',
    );

    const instance = new ec2.Instance(this, 'AppInstance', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: sg,
      role: instanceRole,
      userData,
      // IMDSv2 enforced
      requireImdsv2: true,
    });

    // Elastic IP
    const eip = new ec2.CfnEIP(this, 'AppEip', {
      domain: 'vpc',
    });
    new ec2.CfnEIPAssociation(this, 'AppEipAssoc', {
      instanceId: instance.instanceId,
      allocationId: eip.attrAllocationId,
    });

    // Grant deploy role permission to run commands on this instance via SSM
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:SendCommand'],
      resources: [
        `arn:aws:ec2:${this.region}:${this.account}:instance/${instance.instanceId}`,
        `arn:aws:ssm:${this.region}::document/AWS-RunShellScript`,
      ],
    }));
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetCommandInvocation'],
      resources: ['*'],
    }));

    new cdk.CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      description: 'Set as EC2_INSTANCE_ID in GitHub Actions variables',
    });
    new cdk.CfnOutput(this, 'ElasticIp', {
      value: eip.ref,
      description: 'Public IP of the server',
    });
  }
}
