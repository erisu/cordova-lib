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
const PackageJson = require('@npmcli/package-json');

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
            const pkgJson = await PackageJson.load(projectRoot);

            if (opts.save) {
                let hasUpdatedPackage = false;

                targets.forEach(function (target) {
                    const platformName = target.split('@')[0];
                    const xml = cordova_util.projectConfig(projectRoot);
                    const cfg = new ConfigParser(xml);
                    if (cfg.getEngines && cfg.getEngines().some(function (e) { return e.name === platformName; })) {
                        events.emit('log', 'Removing platform ' + target + ' from config.xml file...');
                        cfg.removeEngine(platformName);
                        cfg.write();
                    }
                    // If package.json exists and contains a specified platform in cordova.platforms, it will be removed.
                    if (pkgJson?.content?.cordova?.platforms?.includes(platformName)) {
                        events.emit('log', 'Removing ' + platformName + ' from cordova.platforms array in package.json');
                        pkgJson.update({
                            cordova: {
                                platforms: [
                                    ...pkgJson.content.cordova.platforms.filter(p => p !== platformName)
                                ]
                            }
                        });
                        hasUpdatedPackage = true;
                    }
                });

                if (hasUpdatedPackage) {
                    return await pkgJson.save();
                }
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
