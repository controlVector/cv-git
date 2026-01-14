/**
 * Build System Parsers
 *
 * Exports all available build system parsers
 */

export { BaseBuildSystemParser, type IBuildSystemParser } from './base.js';
export { CMakeParser } from './cmake.js';
export { MesonParser } from './meson.js';
export { SConsParser } from './scons.js';
export { AutotoolsParser } from './autotools.js';

import { IBuildSystemParser } from './base.js';
import { CMakeParser } from './cmake.js';
import { MesonParser } from './meson.js';
import { SConsParser } from './scons.js';
import { AutotoolsParser } from './autotools.js';

/**
 * Get all available build system parsers
 */
export function getAllParsers(): IBuildSystemParser[] {
  return [
    new CMakeParser(),
    new MesonParser(),
    new SConsParser(),
    new AutotoolsParser()
  ];
}
