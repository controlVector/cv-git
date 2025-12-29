# Multi-Language Microservices Demo

This project demonstrates CV-Git's capabilities across multiple programming languages.

## Architecture

```
┌─────────────────────────────────────────┐
│     API Gateway (TypeScript)            │
│     - Request routing                   │
│     - Authentication checks             │
│     - Service orchestration             │
└──────────┬──────────────────────────────┘
           │
           ├─→ Auth Service (Go)
           │   - User authentication
           │   - Token management
           │   - Password hashing
           │
           ├─→ Data Processing (Python)
           │   - Data transformation
           │   - Validation
           │   - Aggregation
           │
           ├─→ Compute Engine (Rust)
           │   - Heavy computations
           │   - Statistical analysis
           │   - Matrix operations
           │
           └─→ Legacy Integration (Java)
               - Database access
               - Format transformation
               - Batch processing
```

## Languages & Features

| Language | Service | Lines | Features Demonstrated |
|----------|---------|-------|----------------------|
| TypeScript | API Gateway | ~160 | Functions, async/await, interfaces, error handling |
| Python | Data Processor | ~200 | Classes, async, type hints, list comprehensions |
| Go | Auth Service | ~250 | Structs, methods, interfaces, error handling |
| Rust | Compute Engine | ~270 | Traits, impl blocks, generics, tests |
| Java | Legacy Integration | ~250 | Classes, interfaces, generics, JDBC |

## Intentional Patterns for CV-Git Demo

### Call Graph Complexity
- `getMetrics()` (TypeScript) - Calls multiple services
- `aggregate_data()` (Python) - Complex iteration and computation
- `GetUserStats()` (Go) - Multiple map iterations
- `fourier_transform()` (Rust) - Nested loops
- `batchProcess()` (Java) - Exception handling and iteration

### Potential Dead Code
- `process_csv_data()` (Python) - Standalone function never called
- `legacy_computation()` (Rust) - Unused helper function
- `parseXML()` (Java) - Static method for unused XML format

### Cross-Language Dependencies
- API Gateway → All services (inter-language calls)
- Each service is independent (no circular dependencies)

## Testing CV-Git Features

### 1. Semantic Search
```bash
cv find "authentication"
cv find "data transformation"
cv find "complex calculation"
```

### 2. Call Graph Analysis
```bash
cv graph calls handleRequest
cv graph called-by authenticateRequest
```

### 3. Dead Code Detection
```bash
cv graph dead-code
# Should find: process_csv_data, legacy_computation, parseXML
```

### 4. Complexity Analysis
```bash
cv graph complexity --threshold 5
# Should find: getMetrics, aggregate_data, GetUserStats, etc.
```

### 5. Code Explanation
```bash
cv explain "AuthService"
cv explain "DataProcessor"
cv explain "ComputeEngine"
```

## Statistics

- **Total Files:** 5
- **Total Functions:** ~50+
- **Total Lines:** ~1,100+
- **Languages:** 5 (TypeScript, Python, Go, Rust, Java)
- **Services:** 5 (API, Auth, Data, Compute, Legacy)
