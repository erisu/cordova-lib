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
const cordova_util = require('./util');
const ConfigParser = require('cordova-common').ConfigParser;
const events = require('cordova-common').events;
const semver = require('semver');

exports.installPluginsFromConfigXML = installPluginsFromConfigXML;
exports.installPlatformsFromConfigXML = installPlatformsFromConfigXML;

// Install platforms looking at config.xml and package.json (if there is one).
async function installPlatformsFromConfigXML (platforms, opts) {
    events.emit('verbose', 'Checking for saved platforms that haven\'t been added to the project');

    const installAllPlatforms = !platforms || platforms.length === 0;
    const projectRoot = cordova_util.getProjectRoot();
    const platformRoot = path.join(projectRoot, 'platforms');
    // config.xml related path and parser
    const confXmlPath = cordova_util.projectConfig(projectRoot);
    const cfg = new ConfigParser(confXmlPath);
    // package.json data
    const pkgJson = await cordova_util.loadPackageJson(projectRoot);

    const configToPkgJson = {};
    if (cfg.packageName()) {
        configToPkgJson.name = cfg.packageName().toLowerCase();
    }
    if (cfg.version()) {
        configToPkgJson.version = cfg.version();
    }
    if (cfg.name()) {
        configToPkgJson.displayName = cfg.name();
    }
    pkgJson.update(configToPkgJson);

    const pkgPlatforms = pkgJson.content.cordova.platforms.slice();
    const pkgSpecs = Object.assign({}, pkgJson.content.dependencies, pkgJson.content.devDependencies);

    // Check for platforms listed in config.xml
    const cfgPlatforms = cfg.getEngines();

    cfgPlatforms.forEach(engine => {
        const platformModule = engine.name.startsWith('cordova-') ? engine.name : `cordova-${engine.name}`;

        // If package.json includes the platform, we use that config
        // Otherwise, we need to add the platform to package.json
        if (!pkgPlatforms.includes(engine.name) || (engine.spec && !(platformModule in pkgSpecs))) {
            events.emit('info', `Platform '${engine.name}' found in config.xml... Migrating it to package.json`);

            // If config.xml has a spec for the platform and package.json has
            // not, add the spec to devDependencies of package.json
            if (engine.spec && !(platformModule in pkgSpecs)) {
                pkgJson.update({
                    devDependencies: {
                        ...pkgJson.content.devDependencies,
                        [platformModule]: engine.spec
                    }
                });
            }

            if (!pkgPlatforms.includes(engine.name)) {
                pkgJson.update({
                    cordova: {
                        ...pkgJson.content.cordova,
                        platforms: [...pkgJson.content.cordova.platforms, engine.name]
                    }
                });
            }
        }
    });

    // Now that platforms have been updated, re-fetch them from package.json
    const platformIDs = pkgJson.content.cordova.platforms.slice();
    const specs = Object.assign({}, pkgJson.content.dependencies || {}, pkgJson.content.devDependencies);
    const platformInfo = platformIDs.map(plID => ({
        name: plID,
        spec: specs[`cordova-${plID}`] || specs[plID]
    }));
    let platformName = '';

    function restoreCallback (platform) {
        platformName = platform.name;

        const platformPath = path.join(platformRoot, platformName);
        if (fs.existsSync(platformPath) || (!installAllPlatforms && !platforms.includes(platformName))) {
            // Platform already exists
            return Promise.resolve();
        }

        events.emit('log', `Discovered platform "${platformName}". Adding it to the project`);

        // Install from given URL if defined or using a plugin id. If spec
        // isn't a valid version or version range, assume it is the location to
        // install from.
        // CB-10761 If plugin spec is not specified, use plugin name
        let installFrom = platform.spec || platformName;
        if (platform.spec && semver.validRange(platform.spec, true)) {
            installFrom = platformName + '@' + platform.spec;
        }

        const cordovaPlatform = require('./platform');
        return cordovaPlatform('add', installFrom, opts);
    }

    function errCallback (error) {
        // CB-10921 emit a warning in case of error
        const msg = `Failed to restore platform "${platformName}". You might need to try adding it again. Error: ${error}`;
        process.exitCode = 1;
        events.emit('warn', msg);

        return Promise.reject(error);
    }

    if (platformIDs.length !== pkgPlatforms.length) {
        // We've modified package.json and need to save it
        await pkgJson.save();
    }

    // CB-9278 : Run `platform add` serially, one platform after another
    // Otherwise, we get a bug where the following line: https://github.com/apache/cordova-lib/blob/0b0dee5e403c2c6d4e7262b963babb9f532e7d27/cordova-lib/src/util/npm-helper.js#L39
    // gets executed simultaneously by each platform and leads to an exception being thrown
    return platformInfo.reduce(function (soFar, platform) {
        return soFar.then(() => restoreCallback(platform), errCallback);
    }, Promise.resolve());
}

// Returns a promise.
async function installPluginsFromConfigXML (args) {
    events.emit('verbose', 'Checking for saved plugins that haven\'t been added to the project');

    const projectRoot = cordova_util.getProjectRoot();
    const pluginsRoot = path.join(projectRoot, 'plugins');
    const confXmlPath = cordova_util.projectConfig(projectRoot);
    // package.json data
    const pkgJson = await cordova_util.loadPackageJson(projectRoot);
    const pkgPluginIDs = Object.keys(pkgJson.content.cordova.plugins);
    const pkgSpecs = Object.assign({}, pkgJson.content.dependencies, pkgJson.content.devDependencies);

    // Check for plugins listed in config.xml
    const cfg = new ConfigParser(confXmlPath);
    const cfgPluginIDs = cfg.getPluginIdList();

    cfgPluginIDs.forEach(plID => {
        // If package.json includes the plugin, we use that config
        // Otherwise, we need to add the plugin to package.json
        if (!pkgPluginIDs.includes(plID)) {
            events.emit('info', `Plugin '${plID}' found in config.xml... Migrating it to package.json`);

            const cfgPlugin = cfg.getPlugin(plID);

            // If config.xml has a spec for the plugin and package.json has not,
            // add the spec to devDependencies of package.json
            if (cfgPlugin.spec && !(plID in pkgSpecs)) {
                pkgJson.update({
                    devDependencies: {
                        ...pkgJson.content.devDependencies,
                        [plID]: cfgPlugin.spec
                    }
                });
            }

            pkgJson.update({
                cordova: {
                    ...pkgJson.content.cordova,
                    plugins: {
                        ...pkgJson.content.cordova.plugins,
                        [plID]: Object.assign({}, cfgPlugin.variables)
                    }
                }
            });
        }
    });

    // Now that plugins have been updated, re-fetch them from package.json
    const pluginIDs = Object.keys(pkgJson.content.cordova.plugins);
    const specs = Object.assign({}, pkgJson.content.dependencies, pkgJson.content.devDependencies);
    const plugins = pluginIDs.map(plID => ({
        name: plID,
        spec: specs[plID],
        variables: pkgJson.content.cordova.plugins[plID] || {}
    }));

    let pluginName = '';

    function restoreCallback (pluginConfig) {
        pluginName = pluginConfig.name;

        const pluginPath = path.join(pluginsRoot, pluginName);
        if (fs.existsSync(pluginPath)) {
            // Plugin already exists
            return Promise.resolve();
        }

        events.emit('log', `Discovered plugin "${pluginName}". Adding it to the project`);

        // Install from given URL if defined or using a plugin id. If spec isn't a valid version or version range,
        // assume it is the location to install from.
        // CB-10761 If plugin spec is not specified, use plugin name
        let installFrom = pluginConfig.spec || pluginName;
        if (pluginConfig.spec && semver.validRange(pluginConfig.spec, true)) {
            installFrom = pluginName + '@' + pluginConfig.spec;
        }

        // Add feature preferences as CLI variables if have any
        const options = {
            cli_variables: pluginConfig.variables,
            searchpath: args.searchpath,
            save: args.save || false
        };

        const plugin = require('./plugin');
        return plugin('add', installFrom, options);
    }

    function errCallback (error) {
        // CB-10921 emit a warning in case of error
        const msg = `Failed to restore plugin "${pluginName}". You might need to try adding it again. Error: ${error}`;
        process.exitCode = 1;
        events.emit('warn', msg);
    }

    if (pluginIDs.length !== pkgPluginIDs.length) {
        // We've modified package.json and need to save it
        await pkgJson.save();
    }

    // CB-9560 : Run `plugin add` serially, one plugin after another
    // We need to wait for the plugin and its dependencies to be installed
    // before installing the next root plugin otherwise we can have common
    // plugin dependencies installed twice which throws a nasty error.
    return plugins.reduce(function (soFar, plugin) {
        return soFar.then(() => restoreCallback(plugin), errCallback);
    }, Promise.resolve());
}
