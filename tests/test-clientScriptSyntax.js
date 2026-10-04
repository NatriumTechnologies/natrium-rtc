'use strict';

/**
 * tests/test-clientScriptSyntax.js
 * Comprehensive AST parsing and syntax validation for all client scripts in public/js/*.js.
 * Ensures zero syntax errors, unbalanced braces, trailing garbage, or EOF cutoffs.
 */

require('should');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.resolve(__dirname, '..', 'public', 'js');
const jsFiles = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js'));

describe('Pillar 2: Client JavaScript AST and Syntax Integrity Scan', () => {
    it('should find all client-side JavaScript source files', () => {
        jsFiles.length.should.be.greaterThanOrEqual(30, 'Expected at least 30 client scripts in public/js/');
    });

    jsFiles.forEach((filename) => {
        it(`public/js/${filename} must compile cleanly without syntax errors`, () => {
            const filePath = path.join(JS_DIR, filename);
            const stats = fs.statSync(filePath);
            stats.size.should.be.greaterThan(0, `${filename} must not be empty (0 bytes)`);

            const code = fs.readFileSync(filePath, 'utf8');

            // Compile via Node.js vm.Script to verify full AST parse
            let script;
            (() => {
                script = new vm.Script(code, { filename });
            }).should.not.throw();

            (script !== undefined).should.be.true();
        });
    });
});
