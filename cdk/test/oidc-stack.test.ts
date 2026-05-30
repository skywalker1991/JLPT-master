import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { OidcStack } from '../lib/oidc-stack';

describe('OidcStack', () => {
  const app = new cdk.App();
  const stack = new OidcStack(app, 'TestOidcStack', {
    env: { account: '123456789012', region: 'ap-northeast-1' },
    githubOrg: 'testorg',
    githubRepo: 'JLPT-master',
  });
  const template = Template.fromStack(stack);

  test('creates GitHub OIDC provider', () => {
    template.hasResourceProperties('Custom::AWSCDKOpenIdConnectProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIDList: ['sts.amazonaws.com'],
    });
  });

  test('creates deploy role with WebIdentity trust', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'JlptGitHubDeployRole',
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRoleWithWebIdentity',
            Effect: 'Allow',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub':
                  'repo:testorg/JLPT-master:ref:refs/heads/main',
              },
            },
          },
        ],
      },
    });
  });

  test('outputs deploy role ARN', () => {
    template.hasOutput('DeployRoleArn', {});
  });
});
