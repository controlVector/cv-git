/**
 * Type declaration bridging tree-sitter to @keqingmoe/tree-sitter
 * This allows code to import from 'tree-sitter' while using the community fork
 */
declare module 'tree-sitter' {
  export * from '@keqingmoe/tree-sitter';
  export { Parser as default } from '@keqingmoe/tree-sitter';
}
