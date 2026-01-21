/**
 * cv deps - Dependency Analysis Command
 *
 * Analyze project dependencies, check availability, and diagnose build issues
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { DependencyAnalyzer, BuildDiagnostics, createBuildDiagnostics } from '@cv-git/core';
import type { BuildDependency, DetectedBuildSystem, BuildSystem } from '@cv-git/shared';
import ora from 'ora';

export function depsCommand(): Command {
  const cmd = new Command('deps')
    .description('Analyze and manage project dependencies');

  // cv deps analyze
  cmd
    .command('analyze')
    .description('Detect build systems and extract dependencies')
    .option('-d, --dir <path>', 'Directory to analyze', process.cwd())
    .option('--depth <n>', 'Maximum scan depth', '5')
    .option('--json', 'Output as JSON')
    .option('--required-only', 'Only show required dependencies')
    .action(async (options) => {
      const spinner = ora('Analyzing dependencies...').start();

      try {
        const analyzer = new DependencyAnalyzer();
        const analysis = await analyzer.analyze({
          rootDir: options.dir,
          maxDepth: parseInt(options.depth, 10),
          includeOptional: !options.requiredOnly
        });

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(analysis, null, 2));
          return;
        }

        // Display build systems
        console.log(chalk.bold('\nBuild Systems Detected:'));
        if (analysis.buildSystems.length === 0) {
          console.log(chalk.gray('  No build systems detected'));
        } else {
          for (const bs of analysis.buildSystems) {
            const confidence = Math.round(bs.confidence * 100);
            console.log(`  ${chalk.cyan(bs.type)} - ${bs.primaryFile} ${chalk.gray(`(${confidence}% confidence)`)}`);
            if (bs.version) {
              console.log(`    Version: ${bs.version}`);
            }
          }
        }

        // Display dependencies
        console.log(chalk.bold('\nDependencies Found:'));
        if (analysis.dependencies.length === 0) {
          console.log(chalk.gray('  No dependencies detected'));
        } else {
          // Group by type
          const byType = groupByType(analysis.dependencies);

          for (const [type, deps] of Object.entries(byType)) {
            console.log(`\n  ${chalk.yellow(type.toUpperCase())}:`);
            for (const dep of deps) {
              const req = dep.required ? chalk.red('*') : chalk.gray('?');
              const ver = dep.versionConstraint ? chalk.gray(` ${dep.versionConstraint}`) : '';
              const source = chalk.gray(` (${dep.source})`);
              console.log(`    ${req} ${dep.name}${ver}${source}`);
            }
          }
        }

        // Summary
        const requiredCount = analysis.requiredDependencies?.length ?? 0;
        const optionalCount = analysis.optionalDependencies?.length ?? 0;
        console.log(chalk.bold('\nSummary:'));
        console.log(`  Total: ${analysis.dependencies.length} dependencies`);
        console.log(`  Required: ${requiredCount}`);
        console.log(`  Optional: ${optionalCount}`);
        console.log();
      } catch (error) {
        spinner.fail('Analysis failed');
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  // cv deps check
  cmd
    .command('check')
    .description('Check which dependencies are available on the system')
    .option('-d, --dir <path>', 'Directory to analyze', process.cwd())
    .option('--json', 'Output as JSON')
    .option('--missing-only', 'Only show missing dependencies')
    .action(async (options) => {
      const spinner = ora('Checking dependencies...').start();

      try {
        const analyzer = new DependencyAnalyzer();

        // First analyze
        spinner.text = 'Analyzing project...';
        const analysis = await analyzer.analyze({
          rootDir: options.dir,
          includeOptional: true
        });

        if (analysis.dependencies.length === 0) {
          spinner.info('No dependencies found to check');
          return;
        }

        // Check availability
        spinner.text = 'Checking system availability...';
        const availability = await analyzer.checkAvailability(analysis.dependencies);

        spinner.stop();

        if (options.json) {
          const result = {
            dependencies: analysis.dependencies.map(dep => ({
              ...dep,
              systemInfo: availability.get(dep.name)
            }))
          };
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        // Display results
        console.log(chalk.bold('\nDependency Availability:'));

        let available = 0;
        let missing = 0;

        const requiredDeps = analysis.requiredDependencies ?? [];
        const optionalDeps = analysis.optionalDependencies ?? [];

        for (const dep of requiredDeps) {
          const info = availability.get(dep.name);
          if (info?.available) {
            available++;
            if (!options.missingOnly) {
              const ver = info.version ? chalk.gray(` v${info.version}`) : '';
              console.log(`  ${chalk.green('✓')} ${dep.name}${ver}`);
            }
          } else {
            missing++;
            console.log(`  ${chalk.red('✗')} ${dep.name} ${chalk.red('(MISSING)')}`);
          }
        }

        // Show optional deps
        if (!options.missingOnly) {
          for (const dep of optionalDeps) {
            const info = availability.get(dep.name);
            if (info?.available) {
              const ver = info.version ? chalk.gray(` v${info.version}`) : '';
              console.log(`  ${chalk.blue('○')} ${dep.name}${ver} ${chalk.gray('(optional)')}`);
            } else if (!options.missingOnly) {
              console.log(`  ${chalk.yellow('○')} ${dep.name} ${chalk.gray('(optional, not installed)')}`);
            }
          }
        }

        // Summary
        console.log(chalk.bold('\nSummary:'));
        console.log(`  Available: ${chalk.green(available)}`);
        console.log(`  Missing: ${missing > 0 ? chalk.red(missing) : missing}`);

        if (missing > 0) {
          console.log(chalk.yellow('\nRun `cv deps install` to see installation commands.'));
          process.exit(1);
        }

        console.log();
      } catch (error) {
        spinner.fail('Check failed');
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  // cv deps install
  cmd
    .command('install')
    .description('Show installation commands for missing dependencies')
    .option('-d, --dir <path>', 'Directory to analyze', process.cwd())
    .option('--pm <manager>', 'Package manager (apt, yum, dnf, pacman, brew)', 'apt')
    .option('--run', 'Actually run the installation commands')
    .action(async (options) => {
      const spinner = ora('Analyzing dependencies...').start();

      try {
        const analyzer = new DependencyAnalyzer();

        // Analyze
        const analysis = await analyzer.analyze({
          rootDir: options.dir,
          includeOptional: false
        });

        const requiredDeps = analysis.requiredDependencies ?? [];

        if (requiredDeps.length === 0) {
          spinner.info('No required dependencies found');
          return;
        }

        // Check availability
        spinner.text = 'Checking system availability...';
        const availability = await analyzer.checkAvailability(requiredDeps);

        // Find missing
        const missing = requiredDeps.filter(dep => {
          const info = availability.get(dep.name);
          return !info?.available;
        });

        spinner.stop();

        if (missing.length === 0) {
          console.log(chalk.green('\nAll required dependencies are available!'));
          return;
        }

        console.log(chalk.bold('\nMissing Dependencies:'));
        for (const dep of missing) {
          console.log(`  ${chalk.red('✗')} ${dep.name}`);
        }

        // Generate install commands
        const commands = analyzer.generateInstallCommands(
          missing,
          options.pm as 'apt' | 'yum' | 'dnf' | 'pacman' | 'brew'
        );

        if (commands.length === 0) {
          console.log(chalk.yellow('\nCould not determine installation commands.'));
          console.log('Please install the missing dependencies manually.');
          return;
        }

        console.log(chalk.bold('\nInstallation Commands:'));
        for (const cmd of commands) {
          console.log(`  ${chalk.cyan(cmd)}`);
        }

        if (options.run) {
          console.log(chalk.bold('\nRunning installation...'));
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);

          for (const cmd of commands) {
            console.log(chalk.gray(`$ ${cmd}`));
            try {
              const { stdout, stderr } = await execAsync(cmd);
              if (stdout) console.log(stdout);
              if (stderr) console.error(stderr);
            } catch (error) {
              console.error(chalk.red(`Command failed: ${cmd}`));
              if (error instanceof Error) {
                console.error(error.message);
              }
              process.exit(1);
            }
          }
          console.log(chalk.green('\nInstallation complete!'));
        } else {
          console.log(chalk.gray('\nRun with --run to execute these commands.'));
        }
      } catch (error) {
        spinner.fail('Failed');
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  // cv deps diagnose
  cmd
    .command('diagnose')
    .description('Run build, diagnose issues, and suggest workarounds')
    .option('-d, --dir <path>', 'Directory to analyze', process.cwd())
    .option('--target <target>', 'Specific build target')
    .option('--fix', 'Apply automatic workarounds')
    .option('--dry-run', 'Show what --fix would do without applying')
    .option('--timeout <ms>', 'Build timeout in milliseconds', '300000')
    .option('--json', 'Output as JSON')
    .option('--output <file>', 'Path to build output file (skip running build)')
    .action(async (options) => {
      const spinner = ora('Analyzing project...').start();

      try {
        const analyzer = new DependencyAnalyzer();
        const diagnostics = createBuildDiagnostics(options.dir);

        // First detect build system
        const analysis = await analyzer.analyze({
          rootDir: options.dir,
          includeOptional: true
        });

        if (analysis.buildSystems.length === 0) {
          spinner.fail('No build system detected');
          process.exit(1);
        }

        const buildSystem = analysis.buildSystems[0];
        spinner.text = `Detected: ${buildSystem.type} (${buildSystem.primaryFile})`;

        // Read output file if provided, otherwise run build
        let buildOutput: string | undefined;
        if (options.output) {
          const fs = await import('fs/promises');
          try {
            buildOutput = await fs.readFile(options.output, 'utf-8');
            spinner.text = 'Analyzing provided build output...';
          } catch (err) {
            spinner.fail(`Could not read output file: ${options.output}`);
            process.exit(1);
          }
        } else {
          spinner.text = `Running ${buildSystem.type} build...`;
        }

        // Run diagnosis
        const result = await diagnostics.diagnoseAndReport(
          buildSystem.type as BuildSystem,
          {
            fix: options.fix,
            dryRun: options.dryRun,
            target: options.target,
            timeout: parseInt(options.timeout, 10),
            buildOutput
          },
          analysis.dependencies
        );

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify({
            buildSystem: buildSystem.type,
            buildResult: result.buildResult ? {
              success: result.buildResult.success,
              exitCode: result.buildResult.exitCode,
              duration: result.buildResult.duration,
              command: result.buildResult.command
            } : null,
            diagnosis: result.diagnosis.map(d => ({
              issueId: d.issue.id,
              package: d.issue.package,
              severity: d.issue.severity,
              confidence: d.confidence,
              matchedError: d.matchedError,
              lineNumber: d.lineNumber,
              upstreamIssue: d.issue.upstreamIssue,
              workarounds: d.issue.workarounds.map(w => ({
                id: w.id,
                description: w.description,
                automatic: w.automatic
              }))
            })),
            appliedWorkarounds: result.appliedWorkarounds.map(w => w.id)
          }, null, 2));
          return;
        }

        // Print the report
        console.log(result.report);

        // Show applied workarounds
        if (result.appliedWorkarounds.length > 0) {
          console.log(chalk.bold('\nAPPLIED WORKAROUNDS:'));
          for (const w of result.appliedWorkarounds) {
            if (options.dryRun) {
              console.log(chalk.yellow(`  [DRY RUN] Would apply: ${w.id} - ${w.description}`));
            } else {
              console.log(chalk.green(`  ✓ Applied: ${w.id} - ${w.description}`));
            }
          }
          console.log();

          if (!options.dryRun) {
            console.log(chalk.cyan('Workarounds applied. Run your build again to test.'));
          }
        }

        // Exit with appropriate code
        if (result.diagnosis.length > 0 && !options.fix) {
          process.exit(1);
        }
      } catch (error) {
        spinner.fail('Diagnosis failed');
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  // cv deps issues
  cmd
    .command('issues')
    .description('List known build issues in the registry')
    .option('--build-system <system>', 'Filter by build system (bazel, npm, cargo, etc.)')
    .option('--package <name>', 'Filter by package name')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const diagnostics = createBuildDiagnostics(process.cwd());
        let issues = diagnostics.getKnownIssues();

        // Filter by build system
        if (options.buildSystem) {
          issues = issues.filter(i => i.buildSystem === options.buildSystem);
        }

        // Filter by package
        if (options.package) {
          issues = issues.filter(i =>
            i.package === options.package || i.package === '*'
          );
        }

        if (options.json) {
          console.log(JSON.stringify(issues, null, 2));
          return;
        }

        console.log(chalk.bold('\nKnown Build Issues Registry'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log();

        if (issues.length === 0) {
          console.log(chalk.gray('No issues found matching filters.'));
          return;
        }

        for (const issue of issues) {
          const status = issue.status === 'fixed'
            ? chalk.green('[FIXED]')
            : issue.status === 'wontfix'
              ? chalk.yellow('[WONTFIX]')
              : chalk.red('[ACTIVE]');

          console.log(`${chalk.bold(issue.id)} ${status}`);
          console.log(`  Build System: ${chalk.cyan(issue.buildSystem)}`);
          console.log(`  Package: ${chalk.yellow(issue.package)}${issue.affectedVersions ? chalk.gray(` (${issue.affectedVersions})`) : ''}`);
          console.log(`  Severity: ${issue.severity === 'error' ? chalk.red(issue.severity) : chalk.yellow(issue.severity)}`);
          console.log(`  ${issue.description}`);

          if (issue.upstreamIssue) {
            console.log(`  ${chalk.blue('↗')} ${issue.upstreamIssue}`);
          }

          console.log(`  Workarounds: ${issue.workarounds.length}`);
          for (const w of issue.workarounds) {
            const auto = w.automatic ? chalk.green('[AUTO]') : chalk.gray('[MANUAL]');
            console.log(`    ${auto} ${w.id}: ${w.description}`);
          }
          console.log();
        }

        console.log(chalk.gray(`Total: ${issues.length} known issues`));
        console.log();
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  return cmd;
}

function groupByType(deps: BuildDependency[]): Record<string, BuildDependency[]> {
  const result: Record<string, BuildDependency[]> = {};
  for (const dep of deps) {
    if (!result[dep.type]) {
      result[dep.type] = [];
    }
    result[dep.type].push(dep);
  }
  return result;
}
