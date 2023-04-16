import * as cdk from 'aws-cdk-lib';
import { SecretValue } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BuildSpec, LinuxBuildImage, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { CodePipeline } from "aws-cdk-lib/pipelines";
import { CloudFormationCreateUpdateStackAction, CodeBuildAction, GitHubSourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { ServiceStack } from "./service-stack";
// import * as sqs from '@aws-cdk/aws-sqs';
//import { Construct } from '@aws-cdk/core';

export class PipelineCdkStack extends cdk.Stack {
  private readonly pipeline: Pipeline;
  private readonly cdkBuildOutput: Artifact;
  private readonly ServiceBuildOutput: Artifact;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.pipeline = new Pipeline(this, "PipelineCDK", {
      pipelineName: 'PipelineCDK',
      crossAccountKeys: false,
      restartExecutionOnUpdate: true
    });

    const cdkSourceOutput = new Artifact('CDKsourceOutput');
    const serviceSourceOutput = new Artifact('ServiceSourceOutput');

    this.pipeline.addStage({
      stageName: 'Source',
      actions: [
        new GitHubSourceAction({
          owner: 'kengne66',
          repo: 'aws-cdkpipeline',
          branch: 'master',
          actionName: 'Pipeline_Source',
          oauthToken: SecretValue.secretsManager('github-token'),
          output:  cdkSourceOutput
        }),
        new GitHubSourceAction({
          owner: 'kengne66',
          repo: 'express-lambda',
          branch: 'master',
          actionName: 'service_Source',
          oauthToken: SecretValue.secretsManager('github-token'),
          output:  serviceSourceOutput
        })
      ]
    });


    this.cdkBuildOutput = new Artifact('cdkBuildOutput')
    this.ServiceBuildOutput = new Artifact('serviceBuildOutput')

    this.pipeline.addStage({
      stageName: "Build",
      actions: [
        new CodeBuildAction({
          actionName: 'CDK_Build',
          input:  cdkSourceOutput,
          outputs: [this.cdkBuildOutput],
          project: new PipelineProject(this, 'cdkBuildProject', {
            environment: {
              buildImage: LinuxBuildImage.STANDARD_5_0
            },
            buildSpec : BuildSpec.fromAsset(
              'build-specs/cdk-build-spec.yml'
            )
          })
        }),

        new CodeBuildAction({
          actionName: 'Service_Build',
          input:  serviceSourceOutput,
          outputs: [this.ServiceBuildOutput],
          project: new PipelineProject(this, 'ServiceBuildProject', {
            environment: {
              buildImage: LinuxBuildImage.STANDARD_5_0
            },
            buildSpec: BuildSpec.fromSourceFilename(
              '../build-specs/service-build-spec.yml'
            )
          })
        })
      ]
    });

    this.pipeline.addStage( {
      stageName: "pipeline_Update",
      actions: [
        new CloudFormationCreateUpdateStackAction( {
          actionName: "Pipeline_Update",
          stackName: "PipelineStack",
          templatePath: this.cdkBuildOutput.atPath("PipelineStack.template.json"),
          adminPermissions: true
        }),
      ],
    });

  }

  public addServiceStage(serviceStack: ServiceStack, stageName: string) {
    this.pipeline.addStage({
      stageName: stageName,
      actions: [
        new CloudFormationCreateUpdateStackAction({
          actionName: "Service_Update",
          stackName: serviceStack.stackName,
          templatePath: this.cdkBuildOutput.atPath(`${serviceStack.stackName}.template.json`),
          adminPermissions: true,
          parameterOverrides: {
            ...serviceStack.servicecode.assign(this.ServiceBuildOutput.s3Location)
          },
          extraInputs: [this.ServiceBuildOutput]
          
        })
      ]
    })
  }

}
