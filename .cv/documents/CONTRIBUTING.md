# Contributing to CV-Git

Thank you for your interest in contributing to CV-Git! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, inclusive, and constructive. We're all here to build something great together.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/yourusername/cv-git/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (OS, Node version, etc.)
   - Relevant logs or screenshots

### Suggesting Features

1. Check [Discussions](https://github.com/yourusername/cv-git/discussions) for similar ideas
2. Create a new discussion in the "Ideas" category
3. Describe:
   - The problem you're trying to solve
   - Your proposed solution
   - Alternative approaches considered
   - Potential impact on existing features

### Contributing Code

1. **Fork the repository**
   ```bash
   gh repo fork yourusername/cv-git --clone
   cd cv-git
   ```

2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Set up development environment**
   ```bash
   pnpm install
   pnpm build
   
   # Start required services
   docker run -d -p 6379:6379 falkordb/falkordb
   docker run -d -p 6333:6333 qdrant/qdrant
   
   # Set API keys for testing
   export ANTHROPIC_API_KEY=sk-ant-...
   export OPENAI_API_KEY=sk-...
   ```

4. **Make your changes**
   - Write clear, documented code
   - Follow existing code style
   - Add tests for new features
   - Update documentation as needed

5. **Test your changes**
   ```bash
   pnpm build
   pnpm test  # When tests are available
   pnpm typecheck
   ```

6. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add amazing feature"
   ```
   
   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `refactor:` - Code refactoring
   - `test:` - Adding tests
   - `chore:` - Maintenance tasks

7. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then create a Pull Request on GitHub with:
   - Clear title and description
   - Link to related issues
   - Screenshots/demos if applicable

## Development Guidelines

### Code Style

- Use TypeScript strict mode
- Follow existing patterns and conventions
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions focused and small

### Testing

- Add tests for new features (once test framework is set up)
- Ensure all tests pass before submitting PR
- Include both unit and integration tests

### Documentation

- Update README.md if adding new features
- Add/update JSDoc comments
- Update relevant documentation files in `docs/`
- Include examples in commit messages

### Performance

- Consider performance implications
- Avoid unnecessary API calls
- Cache results when appropriate
- Use streaming for long operations

## Project Structure

```
cv-git/
├── packages/
│   ├── cli/          # CLI commands
│   ├── core/         # Core logic
│   └── shared/       # Shared types/utils
├── docs/            # Documentation
└── tests/           # Tests (to be added)
```

## Development Priorities

### High Priority
- [ ] Comprehensive test suite
- [ ] CI/CD pipeline
- [ ] Error handling improvements
- [ ] Performance optimizations

### Medium Priority
- [ ] Python language support
- [ ] Go language support
- [ ] Interactive chat mode
- [ ] Auto-apply for code generation

### Low Priority
- [ ] Additional AI commands
- [ ] Team collaboration features
- [ ] Cloud deployment
- [ ] Web dashboard

## Questions?

- Open a [Discussion](https://github.com/yourusername/cv-git/discussions)
- Join our community (links coming soon)

Thank you for contributing! 🎉
