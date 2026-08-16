import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { PluginManager } from '../src/core/plugin-manager.js';

describe('PluginManager config persistence', () => {
    let originalCwd;
    let tempDir;

    beforeEach(async () => {
        originalCwd = process.cwd();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-manager-'));
        process.chdir(tempDir);

        const pluginDir = path.join(tempDir, 'src', 'plugins', 'demo-plugin');
        await fs.mkdir(pluginDir, { recursive: true });
        await fs.writeFile(
            path.join(pluginDir, 'index.js'),
            "export default { name: 'demo-plugin', description: 'demo plugin', version: '1.0.0' };\n",
            'utf8'
        );
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        await fs.rm(tempDir, { recursive: true, force: true });
        jest.restoreAllMocks();
    });

    test('should skip rewriting config when content is unchanged', async () => {
        const manager = new PluginManager();
        const writeSpy = jest.spyOn(fs, 'writeFile');

        await manager.loadConfig();
        const firstWriteCount = writeSpy.mock.calls.length;

        await manager.loadConfig();

        expect(writeSpy.mock.calls.length).toBe(firstWriteCount);
    });
});
