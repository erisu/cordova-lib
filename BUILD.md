<!--
#
# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
#
-->

# Building from Source Code

This guide explains the needed prerequisites and how to:

* Fetch and extract the source code
* Update the lock file
* Fetch the latest patched dependencies and dev dependencies
* Bundle the project into an npm package

This project uses pure JavaScript and doesn't require compilation.

## 1. Set Up Environment

Install **Git** and **Node.js** (which includes **npm**). These are required for installing dependencies and creating the package.

* **Git:** Use the latest stable version.
* **Node.js:** Use the latest release or LTS listed on the [Node.js website](https://nodejs.org/). The minimum requirements are listed in the `engines` field of the project's `package.json`.

## 2. Get the Source Code

The recommended method is to download it from the [Apache Software Foundation CDN](https://dlcdn.apache.org/).

Alternatively, you can:

* **Clone the repository** and check out the desired release tag (prefixed with `rel/`), or
* **Download a release ZIP** from GitHub by selecting the desired tag under **“Switch branch/tag”** → **“Code”** → **“Download ZIP.”**

> [!NOTE]
> You can build and test the **main** or **feature** branches, but this is **not recommended**.
> These branches may contain unreleased commits and could be unstable. It's recommended to use only **officially released** packages that have been **formally voted on**.
>
> If you are building for a **release vote**, look for tags prefixed with `draft/` or tags that **do not include the `rel/` prefix**.

## 3. Build the Package

1. Extract the source (if needed).
2. Navigate to the source code's root folder.
3. Update the package's npm dependencies:

   ```bash
   npm upgrade
   ```

   The `package-lock.json` file is mainly used in development and contains pinned dependency versions. Since the release, some dependencies may have received updates that fix bugs or security issues, making this file outdated. In a typical workflow (installing from the npm registry), these updates would be fetched automatically because the lock file isn't bundled. To ensure you're using the latest patched dependencies, run the command above.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create an npm package:

   ```bash
   npm pack
   ```

   This creates a tarball named:

   ```
   <package-name>-<package-version>.tar.gz
   ```

   The npm package excludes unnecessary files (e.g., tests and CI configs) to keep it compact and portable.
