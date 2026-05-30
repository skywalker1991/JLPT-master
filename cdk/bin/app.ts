import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { OidcStack } from '../lib/oidc-stack';
import { AppStack } from '../lib/app-stack';

const app = new cdk.App();

// Read from context: cdk deploy -c githubOrg=YOUR_ORG -c githubRepo=JLPT-master
const githubOrg = app.node.tryGetContext('githubOrg') as string;
const githubRepo = (app.node.tryGetContext('githubRepo') as string) ?? 'JLPT-master';

if (!githubOrg) {
  throw new Error('Required context: -c githubOrg=<your-github-org-or-username>');
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
};

const oidcStack = new OidcStack(app, 'JlptOidcStack', {
  env,
  githubOrg,
  githubRepo,
});

new AppStack(app, 'JlptAppStack', {
  env,
  githubOrg,
  githubRepo,
  deployRole: oidcStack.deployRole,
});
