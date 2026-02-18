/**
 * Auth Category Routing
 *
 * Organizes authentication providers into logical categories:
 * - dns: DNS providers (Cloudflare)
 * - devops: Cloud infrastructure (AWS, DigitalOcean)
 * - ai: AI/LLM services (Anthropic, OpenAI, OpenRouter)
 * - git: Git platforms (GitHub, GitLab, Bitbucket)
 */

import chalk from 'chalk';
import inquirer from 'inquirer';

export interface AuthProvider {
  /** Provider identifier */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
}

export interface AuthCategory {
  /** Category identifier */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Providers in this category */
  providers: AuthProvider[];
}

/**
 * All auth categories with their providers
 */
export const AUTH_CATEGORIES: AuthCategory[] = [
  {
    id: 'git',
    name: 'Git Platforms',
    description: 'Git hosting and version control (GitHub, GitLab, Bitbucket, CV-Hub)',
    providers: [
      {
        id: 'github',
        name: 'GitHub',
        description: 'GitHub PAT or CV-Hub proxy authentication',
      },
      {
        id: 'gitlab',
        name: 'GitLab',
        description: 'GitLab Access Token or CV-Hub proxy authentication',
      },
      {
        id: 'bitbucket',
        name: 'Bitbucket',
        description: 'Bitbucket App Password',
      },
      {
        id: 'cv-hub',
        name: 'CV-Hub',
        description: 'Control Fabric code hosting (OAuth Device Flow)',
      },
    ],
  },
  {
    id: 'ai',
    name: 'AI Services',
    description: 'AI/LLM providers (Anthropic, OpenAI, OpenRouter)',
    providers: [
      {
        id: 'anthropic',
        name: 'Anthropic',
        description: 'Claude API access',
      },
      {
        id: 'openai',
        name: 'OpenAI',
        description: 'GPT and embedding API access',
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        description: 'Multi-model AI gateway',
      },
    ],
  },
  {
    id: 'dns',
    name: 'DNS Providers',
    description: 'DNS management and CDN services (Cloudflare)',
    providers: [
      {
        id: 'cloudflare',
        name: 'Cloudflare',
        description: 'DNS, CDN, and security services',
      },
    ],
  },
  {
    id: 'devops',
    name: 'DevOps/Cloud',
    description: 'Cloud infrastructure and deployment (AWS, DigitalOcean)',
    providers: [
      {
        id: 'aws',
        name: 'AWS',
        description: 'Amazon Web Services IAM credentials',
      },
      {
        id: 'digitalocean',
        name: 'DigitalOcean',
        description: 'API, Spaces, and App Platform',
      },
    ],
  },
  {
    id: 'publish',
    name: 'Package Registries',
    description: 'Package publishing (npm, PyPI, crates.io)',
    providers: [
      {
        id: 'npm',
        name: 'npm',
        description: 'Node.js package registry token',
      },
      // Future providers:
      // { id: 'pypi', name: 'PyPI', description: 'Python Package Index' },
      // { id: 'crates', name: 'crates.io', description: 'Rust package registry' },
    ],
  },
];

/**
 * Get a category by ID
 */
export function getCategory(categoryId: string): AuthCategory | undefined {
  return AUTH_CATEGORIES.find((c) => c.id === categoryId);
}

/**
 * Get a provider by path (e.g., "dns/cloudflare" or just "cloudflare")
 */
export function getProvider(path: string): {
  category: AuthCategory;
  provider: AuthProvider;
} | undefined {
  // Check if path includes category (e.g., "dns/cloudflare")
  if (path.includes('/')) {
    const [categoryId, providerId] = path.split('/');
    const category = getCategory(categoryId);
    if (!category) return undefined;
    const provider = category.providers.find((p) => p.id === providerId);
    if (!provider) return undefined;
    return { category, provider };
  }

  // Search all categories for provider
  for (const category of AUTH_CATEGORIES) {
    const provider = category.providers.find((p) => p.id === path);
    if (provider) {
      return { category, provider };
    }
  }

  return undefined;
}

/**
 * Get all provider IDs across all categories
 */
export function getAllProviderIds(): string[] {
  const ids: string[] = [];
  for (const category of AUTH_CATEGORIES) {
    for (const provider of category.providers) {
      ids.push(provider.id);
    }
  }
  return ids;
}

/**
 * Display category selection menu
 */
export async function selectCategory(): Promise<AuthCategory | null> {
  console.log(chalk.bold('\n🔐 Select Authentication Category\n'));

  const choices = AUTH_CATEGORIES.map((cat) => ({
    name: `${chalk.cyan(cat.name.padEnd(15))} ${chalk.gray(cat.description)}`,
    value: cat.id,
  }));

  choices.push({
    name: `${chalk.yellow('Cancel'.padEnd(15))} ${chalk.gray('Return to menu')}`,
    value: 'cancel',
  });

  const { categoryId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'categoryId',
      message: 'Choose a category:',
      choices,
    },
  ]);

  if (categoryId === 'cancel') {
    return null;
  }

  return getCategory(categoryId) || null;
}

/**
 * Display provider selection menu for a category
 */
export async function selectProvider(category: AuthCategory): Promise<AuthProvider | null> {
  console.log(chalk.bold(`\n🔐 ${category.name} - Select Provider\n`));

  const choices = category.providers.map((provider) => ({
    name: `${chalk.cyan(provider.name.padEnd(15))} ${chalk.gray(provider.description)}`,
    value: provider.id,
  }));

  choices.push({
    name: `${chalk.yellow('Back'.padEnd(15))} ${chalk.gray('Return to categories')}`,
    value: 'back',
  });

  const { providerId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'providerId',
      message: 'Choose a provider:',
      choices,
    },
  ]);

  if (providerId === 'back') {
    return null;
  }

  return category.providers.find((p) => p.id === providerId) || null;
}

/**
 * Parse service argument into category/provider paths
 * Handles: "all", "dns", "dns/cloudflare", "cloudflare", etc.
 */
export function parseServiceArg(service: string | undefined): {
  mode: 'all' | 'category' | 'provider' | 'interactive';
  categoryId?: string;
  providerId?: string;
} {
  if (!service) {
    return { mode: 'interactive' };
  }

  if (service === 'all') {
    return { mode: 'all' };
  }

  // Check if it's a category
  const category = getCategory(service);
  if (category) {
    return { mode: 'category', categoryId: service };
  }

  // Check if it's a category/provider path
  if (service.includes('/')) {
    const [categoryId, providerId] = service.split('/');
    return { mode: 'provider', categoryId, providerId };
  }

  // Check if it's just a provider ID
  const providerResult = getProvider(service);
  if (providerResult) {
    return {
      mode: 'provider',
      categoryId: providerResult.category.id,
      providerId: service,
    };
  }

  // Unknown - treat as provider and let caller handle error
  return { mode: 'provider', providerId: service };
}
