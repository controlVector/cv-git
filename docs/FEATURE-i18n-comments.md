---
type: design_spec
status: planned
tags: [i18n, localization, comments, translation, multilingual, ai]
relates_to: [packages/core, packages/cli, packages/shared]
version: "future"
created: 2026-01-12
---

# Feature: Multilingual Code Comment Normalization

## Problem Statement

Modern software development involves a **three-way language barrier**:

1. **AI-Human**: AI assistants generate code comments in various languages based on context
2. **Human-Human**: International teams write comments in their native languages (English, German, Mandarin, Spanish, etc.)
3. **AI-AI**: Different AI models may have different language preferences or training biases

This creates friction when:
- A German developer reads Japanese comments
- An AI assistant encounters mixed-language documentation
- Code review involves team members from different language backgrounds
- Knowledge graph search fails due to language mismatch

## Proposed Solution

### Core Concept: Language-Aware Knowledge Graph

Store the **source language** of all text content while providing **per-user translation** on demand.

```
┌─────────────────────────────────────────────────────────────┐
│                    Knowledge Graph                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Symbol: calculateTax                                 │   │
│  │ docstring: "税金を計算する" (ja)                      │   │
│  │ sourceLanguage: "ja"                                 │   │
│  │ translations: {                                      │   │
│  │   "en": "Calculate tax",                             │   │
│  │   "de": "Steuern berechnen"                          │   │
│  │ }                                                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
    ┌─────────┐       ┌─────────┐       ┌─────────┐
    │ Dev (en)│       │ Dev (de)│       │ Dev (ja)│
    │ Sees:   │       │ Sees:   │       │ Sees:   │
    │ English │       │ German  │       │ Japanese│
    └─────────┘       └─────────┘       └─────────┘
```

---

## User Experience

### 1. Setting Language Preferences

```bash
# Set preferred language for viewing comments
cv preferences set language.display en

# Set language for writing comments (AI-generated)
cv preferences set language.write en

# View current settings
cv preferences get language
# {
#   "display": "en",
#   "write": "en",
#   "autoDetect": true,
#   "translateOnRead": true
# }
```

### 2. Viewing Translated Comments

```bash
# Normal usage - comments auto-translated to user's display language
cv explain calculateTax
# Output: "Calculate tax - computes the tax amount based on income brackets"

# View original (untranslated)
cv explain calculateTax --original
# Output: "税金を計算する - 所得税率に基づいて税額を計算します"

# View in specific language
cv explain calculateTax --lang de
# Output: "Steuern berechnen - berechnet den Steuerbetrag basierend auf Einkommensklassen"
```

### 3. Writing with Language Awareness

```bash
# AI-generated commit messages in user's preferred language
cv commit -m "auto"
# Generates message in user's language.write preference

# Force specific language for commit
cv commit -m "auto" --lang ja
```

---

## Technical Design

### 1. Schema Extensions

```typescript
// packages/shared/src/types.ts

interface LocalizedText {
  content: string;           // Original text
  sourceLanguage: string;    // ISO 639-1 code (en, de, ja, zh, etc.)
  detectedConfidence: number; // 0-1 confidence in detection
  translations?: Record<string, string>; // Cached translations
  translatedAt?: Record<string, number>; // When each translation was created
}

interface SymbolNode {
  // ... existing fields
  docstring?: string;        // For backwards compatibility
  localizedDocstring?: LocalizedText;  // New: rich localized content
}

interface CommitNode {
  // ... existing fields
  message: string;           // For backwards compatibility
  localizedMessage?: LocalizedText;
}
```

### 2. Language Detection Service

```typescript
// packages/core/src/i18n/language-detector.ts

interface LanguageDetector {
  /**
   * Detect language of text
   * Uses heuristics + optional AI model for accuracy
   */
  detect(text: string): Promise<{
    language: string;      // ISO 639-1 code
    confidence: number;    // 0-1
    isCode: boolean;       // Contains code snippets
  }>;

  /**
   * Detect if text is mixed-language
   */
  detectMixed(text: string): Promise<{
    primary: string;
    segments: Array<{ text: string; language: string; start: number; end: number }>;
  }>;
}
```

### 3. Translation Service

```typescript
// packages/core/src/i18n/translator.ts

interface TranslationService {
  /**
   * Translate text to target language
   * Caches results in knowledge graph
   */
  translate(
    text: string,
    from: string,
    to: string,
    options?: {
      context?: string;      // Code context for technical accuracy
      preserveCode?: boolean; // Don't translate code blocks
      cacheKey?: string;     // For storing in graph
    }
  ): Promise<string>;

  /**
   * Batch translate for efficiency
   */
  translateBatch(
    texts: Array<{ text: string; from: string }>,
    to: string
  ): Promise<string[]>;
}
```

### 4. User Preferences Schema

```typescript
// packages/shared/src/config.ts

interface LanguagePreferences {
  /** Language for displaying comments/docs to user */
  display: string;  // Default: 'en'

  /** Language for AI-generated content (commits, docs) */
  write: string;    // Default: matches display

  /** Auto-detect source language of content */
  autoDetect: boolean;  // Default: true

  /** Translate on read (vs. only on-demand) */
  translateOnRead: boolean;  // Default: true

  /** Fallback language if translation unavailable */
  fallback: string;  // Default: 'en'

  /** Languages user can read (skip translation) */
  readableLanguages: string[];  // Default: [display]
}
```

---

## Graph Storage

### Node Properties

```cypher
// Symbol with localized docstring
MERGE (s:Symbol:Function {qualifiedName: $qn})
SET s.docstring = $docstring,
    s.docstringLang = $lang,
    s.docstringConfidence = $confidence

// Translation cache (separate nodes for flexibility)
MERGE (t:Translation {
  sourceHash: $hash,
  sourceLang: $from,
  targetLang: $to
})
SET t.content = $translation,
    t.translatedAt = $timestamp,
    t.model = $model
```

### Query with Translation

```cypher
// Get symbol with translated docstring
MATCH (s:Symbol {qualifiedName: $qn})
OPTIONAL MATCH (t:Translation {
  sourceHash: hash(s.docstring),
  targetLang: $userLang
})
RETURN s, COALESCE(t.content, s.docstring) as docstring
```

---

## Implementation Phases

### Phase 1: Foundation (v0.6)
- [ ] Add `LocalizedText` type to shared types
- [ ] Add language preferences to user config
- [ ] Language detection using heuristics (no AI required)
- [ ] Store `sourceLanguage` during sync

### Phase 2: Translation Layer (v0.7)
- [ ] Translation service interface
- [ ] Integration with AI translation (Anthropic/OpenAI)
- [ ] Translation caching in graph
- [ ] `--lang` flag for CLI commands

### Phase 3: Smart Features (v0.8)
- [ ] Mixed-language detection
- [ ] Code-aware translation (preserve identifiers)
- [ ] Batch translation during sync
- [ ] MCP tool for translated context

### Phase 4: Polish (v0.9)
- [ ] Translation quality scoring
- [ ] User corrections/overrides
- [ ] Offline translation cache
- [ ] IDE integration hints

---

## Translation Providers

### Primary: AI Model Translation
- Use configured AI provider (Anthropic, OpenAI)
- Technical context improves accuracy
- Higher quality for code comments

### Fallback: External Services
- Google Translate API
- DeepL API
- LibreTranslate (self-hosted option)

### Configuration

```yaml
# .cv/config.yaml
translation:
  provider: ai          # ai, google, deepl, libretranslate
  fallbackProvider: google
  cacheExpiry: 30d      # How long to cache translations
  batchSize: 50         # Batch size for bulk translation

  # AI-specific
  ai:
    model: claude-3-haiku  # Smaller model for translation
    systemPrompt: |
      Translate code documentation accurately.
      Preserve technical terms and identifiers.
      Maintain formatting (markdown, etc.).
```

---

## CLI Commands

```bash
# Translation-related commands
cv translate <text> --from ja --to en    # Direct translation
cv translate file.ts --to de             # Translate file comments

# Sync with translation
cv sync --translate                       # Translate all during sync
cv sync --translate --langs en,de,ja     # Pre-translate to specific languages

# Query with language awareness
cv find "error handling" --lang ja        # Search across languages
cv explain MyClass --lang de              # Explain in German

# Preferences
cv preferences set language.display de
cv preferences set language.readableLanguages en,de
```

---

## MCP Integration

```typescript
// New tool for translated context
{
  name: 'cv_context_translated',
  description: 'Get code context with comments translated to specified language',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      language: {
        type: 'string',
        description: 'Target language (ISO 639-1)',
        default: 'en'
      }
    }
  }
}
```

---

## Considerations

### Privacy
- Translation may send code to external services
- Offer local/offline translation options
- Clear documentation on data handling

### Performance
- Cache translations aggressively
- Batch translations during sync
- Lazy translate on-demand for less common languages

### Accuracy
- Technical terms need special handling
- Identifier names should not be translated
- Context helps AI translation accuracy

### Storage
- Translations add storage overhead
- Consider on-demand vs. pre-computed
- Expiry/refresh policy for stale translations

---

## Success Metrics

1. **Developer Experience**
   - Time to understand foreign-language comments reduced by 80%
   - No manual translation tool switching required

2. **Search Quality**
   - Cross-language search returns relevant results
   - Language doesn't affect discoverability

3. **Team Collaboration**
   - Mixed-language teams can review code effectively
   - AI-generated content matches team preferences

---

## Open Questions

1. Should translation be opt-in or opt-out by default?
2. How to handle translation disagreements (multiple valid translations)?
3. Should we support regional variants (en-US vs en-GB, zh-CN vs zh-TW)?
4. How to handle emoji and non-text content in comments?
5. Should translation apply to variable/function names or just comments?

---

## Related Work

- GitHub Copilot: Generates code in user's language context
- JetBrains AI: IDE-integrated translation
- Crowdin/Lokalise: Localization platforms (different use case)
- DeepL Write: Context-aware translation

---

## Appendix: Supported Languages (Initial)

| Code | Language | Priority |
|------|----------|----------|
| en | English | High |
| de | German | High |
| ja | Japanese | High |
| zh | Chinese (Simplified) | High |
| es | Spanish | Medium |
| fr | French | Medium |
| ko | Korean | Medium |
| pt | Portuguese | Medium |
| ru | Russian | Medium |
| it | Italian | Low |
| nl | Dutch | Low |
| pl | Polish | Low |
