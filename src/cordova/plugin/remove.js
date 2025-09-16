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
const ConfigParser = require('cordova-common').ConfigParser;
const CordovaError = require('cordova-common').CordovaError;
const events = require('cordova-common').events;
const cordova_util = require('../util');
const plugin_util = require('./util');
const plugman = require('../../plugman/plugman');
const metadata = require('../../plugman/util/metadata');
const PluginInfoProvider = require('cordova-common').PluginInfoProvider;
const { Q_chainmap } = require('../../util/promise-util');
const preparePlatforms = require('../prepare/platforms');

module.exports = remove;
module.exports.validatePluginId = validatePluginId;

function remove (projectRoot, targets, hooksRunner, opts) {
    if (!targets || !targets.length) {
        return Promise.reject(new CordovaError('No plugin specified. Please specify a plugin to remove. See: ' + cordova_util.binname + ' plugin list.'));
    }
    const pluginPath = path.join(projectRoot, 'plugins');
    const plugins = cordova_util.findPlugins(pluginPath);
    const platformList = cordova_util.listPlatforms(projectRoot);
    let shouldRunPrepare = false;
    const xml = cordova_util.projectConfig(projectRoot);
    const cfg = new ConfigParser(xml);

    opts.cordova = { plugins: cordova_util.findPlugins(pluginPath) };
    return hooksRunner.fire('before_plugin_rm', opts)
        .then(function () {
            return Q_chainmap(opts.plugins, removePlugin);
        }).then(function () {
            // CB-11022 We do not need to run prepare after plugin install until shouldRunPrepare flag is set to true
            if (!shouldRunPrepare) {
                return Promise.resolve();
            }
            return preparePlatforms(platformList, projectRoot, opts);
        }).then(function () {
            opts.cordova = { plugins: cordova_util.findPlugins(pluginPath) };
            return hooksRunner.fire('after_plugin_rm', opts);
        });

    function removePlugin (target) {
        return Promise.resolve()
            .then(function () {
                const validatedPluginId = module.exports.validatePluginId(target, plugins);
                if (!validatedPluginId) {
                    throw new CordovaError('Plugin "' + target + '" is not present in the project. See `' + cordova_util.binname + ' plugin list`.');
                }
                target = validatedPluginId;
            }).then(function () {
                // Iterate over all installed platforms and uninstall.
                // If this is a web-only or dependency-only plugin, then
                // there may be nothing to do here except remove the
                // reference from the platform's plugin config JSON.
                return Q_chainmap(platformList, platform =>
                    removePluginFromPlatform(target, platform)
                );
            }).then(function () {
                // TODO: Should only uninstallPlugin when no platforms have it.
                return plugman.uninstall.uninstallPlugin(target, pluginPath, opts);
            }).then(async function () {
                if (!opts.save) return;
                persistRemovalToCfg(target);
                await persistRemovalToPkg(target);
            }).then(function () {
                // Remove plugin from fetch.json
                events.emit('verbose', 'Removing plugin ' + target + ' from fetch.json');
                metadata.remove_fetch_metadata(pluginPath, target);
            });
    }

    function removePluginFromPlatform (target, platform) {
        let platformRoot;

        return Promise.resolve().then(function () {
            platformRoot = path.join(projectRoot, 'platforms', platform);
            const directory = path.join(pluginPath, target);
            const pluginInfo = new PluginInfoProvider().get(directory);
            events.emit('verbose', 'Calling plugman.uninstall on plugin "' + target + '" for platform "' + platform + '"');
            opts.force = opts.force || false;

            return plugin_util.mergeVariables(pluginInfo, cfg, opts);
        }).then(function (variables) {
            // leave opts.cli_variables untouched, so values discarded by mergeVariables()
            // for this platform are still available for other platforms
            const platformOpts = { ...opts, cli_variables: variables };

            return plugman.uninstall.uninstallPlatform(platform, platformRoot, target, pluginPath, platformOpts)
                .then(function (didPrepare) {
                    // If platform does not returned anything we'll need
                    // to trigger a prepare after all plugins installed
                    // TODO: if didPrepare is falsy, what does that imply? WHY are we doing this?
                    if (!didPrepare) shouldRunPrepare = true;
                });
        });
    }

    function persistRemovalToCfg (target) {
        const configPath = cordova_util.projectConfig(projectRoot);
        if (fs.existsSync(configPath)) { // should not happen with real life but needed for tests
            const configXml = new ConfigParser(configPath);

            if (configXml.getPlugin(target)) {
                events.emit('log', 'Removing plugin ' + target + ' from config.xml file...');
                configXml.removePlugin(target);
                configXml.write();
            }
        }
    }

    async function persistRemovalToPkg (target) {
        // Load the application's package.json
        const pkgJson = await cordova_util.loadPackageJson(projectRoot);
        // Get current cordova structure
        const cordova = pkgJson.content.cordova;
        // Get the current plugins
        const plugins = cordova.plugins;
        // Check if the targeted plugin exists on scope
        if (plugins[target]) {
            events.emit('log', `Removing plugin "${target}" from package.json`);
            // Create an updated plugin list with target removed
            const { [target]: _, ...updatedPlugins } = plugins;
            // Update the Cordova scope..
            cordova.plugins = updatedPlugins;
            // Update package.json
            pkgJson.update({ cordova });
            // Save the changes
            await pkgJson.save();
        }
    }
}

function validatePluginId (pluginId, installedPlugins) {
    if (installedPlugins.indexOf(pluginId) >= 0) {
        return pluginId;
    }

    if (pluginId.indexOf('cordova-plugin-') < 0) {
        return validatePluginId('cordova-plugin-' + pluginId, installedPlugins);
    }
}
