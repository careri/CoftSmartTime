# Linting

Enable build linting that fails on unused variables, methods, classes and imports

## Implementation Suggestions

1. **Update tsconfig.json**:
   - Uncomment and set `"noUnusedLocals": true` to report errors on unused local variables, functions, and classes
   - Uncomment and set `"noUnusedParameters": true` to report errors on unused function parameters

2. **Update eslint.config.mjs**:
   - Add `"@typescript-eslint/no-unused-vars": "error"` to the rules to enforce no unused imports and variables

3. **Verify build process**:
   - Ensure `npm run lint` is run before tests (currently in `pretest` script)
   - Run `npm run compile` to check for TypeScript unused errors
   - Run `npm test` to ensure linting fails the build on violations

4. **Clean up existing unused code** (if any):
   - After enabling, fix any existing unused variables/parameters by removing or prefixing with `_`
   - For intentionally unused parameters, use `_param` or `// eslint-disable-next-line`

5. **Testing**:
   - Add a test file with unused code to verify linting catches it
   - Ensure CI/build fails on unused code
