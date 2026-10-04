'use strict';

/**
 * tests/test-assetIntegrity.js
 * Comprehensive integrity verification for HTML, CSS, and JS assets:
 * 1. Cloudflare Rocket Loader compatibility (data-cfasync="false" on all script tags)
 * 2. Background audio continuity (#audioMediaContainer must never be display: none)
 * 3. Local asset reference existence and non-zero size
 * 4. Full syntax and parsing validation for all public/js/*.js files
 */

require('should');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const VIEWS_DIR = path.join(PUBLIC_DIR, 'views');
const JS_DIR = path.join(PUBLIC_DIR, 'js');
const CSS_DIR = path.join(PUBLIC_DIR, 'css');

describe('Pillar 1: Asset Integrity and Cloudflare Compatibility', () => {
    describe('1. Cloudflare Rocket Loader Script Tags', () => {
        it('client.html must have data-cfasync="false" on every <script> tag', () => {
            const clientHtmlPath = path.join(VIEWS_DIR, 'client.html');
            fs.existsSync(clientHtmlPath).should.be.true('client.html should exist');
            const html = fs.readFileSync(clientHtmlPath, 'utf8');

            const scriptMatches = html.match(/<script\b[^>]*>/gi) || [];
            scriptMatches.length.should.be.greaterThan(20, 'client.html should contain scripts');

            const missingCfTags = scriptMatches.filter((tag) => !tag.includes('data-cfasync="false"'));
            missingCfTags.should.deepEqual(
                [],
                'All script tags in client.html must have data-cfasync="false" to prevent Rocket Loader race conditions'
            );
        });

        it('landing.html must have data-cfasync="false" on every <script> tag', () => {
            const landingHtmlPath = path.join(VIEWS_DIR, 'landing.html');
            fs.existsSync(landingHtmlPath).should.be.true('landing.html should exist');
            const html = fs.readFileSync(landingHtmlPath, 'utf8');

            const scriptMatches = html.match(/<script\b[^>]*>/gi) || [];
            scriptMatches.length.should.be.greaterThan(5, 'landing.html should contain scripts');

            const missingCfTags = scriptMatches.filter((tag) => !tag.includes('data-cfasync="false"'));
            missingCfTags.should.deepEqual(
                [],
                'All script tags in landing.html must have data-cfasync="false" to prevent Rocket Loader race conditions'
            );
        });
    });

    describe('2. Background Audio Container Layout Safety', () => {
        it('#audioMediaContainer must not be display: none in client.css', () => {
            const clientCssPath = path.join(CSS_DIR, 'client.css');
            fs.existsSync(clientCssPath).should.be.true('client.css should exist');
            const css = fs.readFileSync(clientCssPath, 'utf8');

            const containerBlockMatch = css.match(/#audioMediaContainer\s*\{([^}]+)\}/);
            (containerBlockMatch !== null).should.be.true('#audioMediaContainer rule must exist in client.css');

            const blockBody = containerBlockMatch[1];
            blockBody.should.not.match(
                /display\s*:\s*none/i,
                '#audioMediaContainer must NEVER be display: none, otherwise browsers pause background audio'
            );
            blockBody.should.not.match(
                /visibility\s*:\s*hidden/i,
                '#audioMediaContainer must not have visibility: hidden'
            );
            blockBody.should.match(
                /position\s*:\s*fixed/i,
                '#audioMediaContainer should use offscreen position: fixed'
            );
        });
    });

    describe('3. Local Asset Reference Validation', () => {
        function verifyHtmlLocalAssets(htmlFile) {
            const htmlPath = path.join(VIEWS_DIR, htmlFile);
            const html = fs.readFileSync(htmlPath, 'utf8');
            const regex = /(?:src|href)=["'](\.\.\/[^"'\s?#]+)/g;
            let match;
            const verified = [];

            while ((match = regex.exec(html)) !== null) {
                const relativePath = match[1];
                const resolvedPath = path.resolve(VIEWS_DIR, relativePath);
                fs.existsSync(resolvedPath).should.be.true(
                    `Referenced asset ${relativePath} in ${htmlFile} must exist on disk`
                );
                const stats = fs.statSync(resolvedPath);
                stats.size.should.be.greaterThan(
                    0,
                    `Asset ${relativePath} in ${htmlFile} must not be empty (0 bytes)`
                );
                verified.push(relativePath);
            }

            verified.length.should.be.greaterThan(0, `${htmlFile} must reference local assets`);
        }

        it('All local assets referenced in client.html must exist and have non-zero size', () => {
            verifyHtmlLocalAssets('client.html');
        });

        it('All local assets referenced in landing.html must exist and have non-zero size', () => {
            verifyHtmlLocalAssets('landing.html');
        });
    });

    describe('4. JavaScript Code Syntax and Integrity', () => {
        it('All JavaScript files in public/js/ must compile cleanly without syntax errors', () => {
            const files = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js'));
            files.length.should.be.greaterThan(25, 'Should find client JS files in public/js');

            const errors = [];
            for (const file of files) {
                const filePath = path.join(JS_DIR, file);
                const content = fs.readFileSync(filePath, 'utf8');
                try {
                    // Test parsing using Node vm.Script
                    new vm.Script(content, { filename: file });
                } catch (err) {
                    errors.push({ file, error: err.message });
                }
            }

            errors.should.deepEqual([], 'All client JS files must be free of syntax errors or truncation');
        });

        it('client.js must contain essential WebRTC bootstrap functions', () => {
            const clientJsPath = path.join(JS_DIR, 'client.js');
            const content = fs.readFileSync(clientJsPath, 'utf8');

            content.should.containEql('async function initClientPeer(');
            content.should.containEql('function getRoomParticipantsCount(');
            content.should.containEql('async function toggleScreenSharing(');
            content.should.containEql('async function startScreenSharing(');
            content.should.containEql('async function stopScreenSharing(');
        });
    });
});
