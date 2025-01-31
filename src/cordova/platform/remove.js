/**
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/

const fs = require('node:fs');
const path = require('node:path');
const CordovaError = require('cordova-common').CordovaError;
const ConfigParser = require('cordova-common').ConfigParser;
const events = require('cordova-common').events;
const npmUninstall = require('cordova-fetch').uninstall;
const cordova_util = require('../util');
const promiseutil = require('../../util/promise-util');
const platforms = require('../../platforms/platforms');

module.exports = remove;

function remove (hooksRunner, projectRoot, targets, opts) {
    if (!targets || !targets.length) {
        return Promise.reject(new CordovaError('No platform(s) specified. Please specify platform(s) to remove. See `' + cordova_util.binname + ' platform list`.'));
    }
    return hooksRunner.fire('before_platform_rm', opts)
        .then(function () {
            targets.forEach(function (target) {
                fs.rmSync(path.join(projectRoot, 'platforms', target), { recursive: true, force: true });
                cordova_util.removePlatformPluginsJson(projectRoot, target);
            });
        }).then(async function () {
            if (opts.save) {
                // Load the application's package.json
                const pkgJson = await cordova_util.loadPackageJson(projectRoot);
                // Get current cordova structure
                const cordova = pkgJson.content.cordova;
                // Get the current platforms
                const platforms = cordova.platforms;
                // Remove version information from the targeted platforms to remove.
                const platformNames = targets.map(platform => platform.split('@')[0]);
                // Create updated platforms list for package.json update.
                const updatedPlatforms = platforms.filter(platform => !platformNames.includes(platform));
                cordova.platforms = updatedPlatforms;
                // Update package.json
                pkgJson.update({ cordova });
                // Save the changes
                await pkgJson.save();

                events.emit('log', `Removing the following platform(s) "${platformNames.join(', ')}" from cordova.platforms array in package.json`);

                platformNames.forEach(platformName => {
                    const xml = cordova_util.projectConfig(projectRoot);
                    const cfg = new ConfigParser(xml);
                    if (cfg.getEngines && cfg.getEngines().some(function (e) { return e.name === platformName; })) {
                        events.emit('log', `Removing platform "${platformName}" from config.xml file...`);
                        cfg.removeEngine(platformName);
                        cfg.write();
                    }
                });
            }
        }).then(function () {
            // Remove targets from platforms.json.
            targets.forEach(function (target) {
                events.emit('verbose', 'Removing platform ' + target + ' from platforms.json file...');
            });
        }).then(function () {
            // Remove from node_modules if it exists
            return promiseutil.Q_chainmap(targets, function (target) {
                if (target in platforms) {
                    target = 'cordova-' + target;
                }
                // Edits package.json.
                return npmUninstall(target, projectRoot, opts);
            });
        }).then(function () {
            return hooksRunner.fire('after_platform_rm', opts);
        });
}
