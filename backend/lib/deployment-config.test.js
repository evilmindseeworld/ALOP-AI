const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function parseDockerNodeBases(text) {
  const bases = [];
  const fromPattern = /^[ \t]*FROM[ \t]+node:([^\s]+)(?:[ \t]+AS[ \t]+[^\s]+)?[ \t]*$/gim;

  for (const match of text.matchAll(fromPattern)) {
    const tag = match[1];
    const majorMatch = tag.match(/^(\d+)(?:$|[-.])/);
    assert.ok(
      majorMatch,
      `backend/Dockerfile has FROM node:${tag}, but its major is not parseable. Edit backend/Dockerfile to use a numeric Node tag.`,
    );
    bases.push({
      major: Number(majorMatch[1]),
      tag,
      line: lineNumber(text, match.index),
    });
  }

  assert.ok(
    bases.length > 0,
    'backend/Dockerfile has no parseable FROM node:<major> declaration. Edit backend/Dockerfile before changing the runtime pin.',
  );
  return bases;
}

function parseCiNodeVersions(text) {
  const versions = [];
  const nodeVersionPattern = /^[ \t]*node-version[ \t]*:[ \t]*([^\r\n#]+?)(?:[ \t]+#.*)?$/gim;

  for (const match of text.matchAll(nodeVersionPattern)) {
    const raw = match[1].trim();
    const value = raw.replace(/^(['"])(.*)\1$/, '$2');
    const majorMatch = value.match(/^v?(\d+)(?:\.\d+){0,2}$/);
    assert.ok(
      majorMatch,
      `.github/workflows/ci.yml node-version at line ${lineNumber(text, match.index)} is ${JSON.stringify(value)}, not a parseable Node version. Edit that node-version entry.`,
    );
    versions.push({
      major: Number(majorMatch[1]),
      value,
      line: lineNumber(text, match.index),
    });
  }

  assert.ok(
    versions.length > 0,
    '.github/workflows/ci.yml has no node-version entries. Edit the workflow to restore its pinned Node version.',
  );
  return versions;
}

function tomlSection(text, header) {
  const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerPattern = new RegExp(`^[ \\t]*${escapedHeader}[ \\t]*$`, 'mi');
  const match = headerPattern.exec(text);
  if (!match) return null;

  const bodyStart = match.index + match[0].length;
  const body = text.slice(bodyStart);
  const nextHeader = body.search(/^[ \t]*\[/m);
  return nextHeader === -1 ? body : body.slice(0, nextHeader);
}

function parseTomlInteger(section, label, key) {
  const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*"?(\\d+)"?[ \\t]*(?:#.*)?$`, 'mi');
  const match = pattern.exec(section);
  assert.ok(
    match,
    `${label} is missing or not a numeric TOML value. Edit backend/fly.toml so ${label} is explicit.`,
  );
  return Number(match[1]);
}

function parseTomlString(section, label, key) {
  const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*"([^"\\r\\n]+)"[ \\t]*(?:#.*)?$`, 'mi');
  const match = pattern.exec(section);
  assert.ok(
    match,
    `${label} is missing or not a quoted TOML string. Edit backend/fly.toml so ${label} is explicit.`,
  );
  return match[1];
}

function parseDockerExposes(text) {
  const exposes = [];
  const exposePattern = /^[ \t]*EXPOSE[ \t]+(\d+)(?:\/[A-Za-z]+)?[ \t]*(?:#.*)?$/gim;

  for (const match of text.matchAll(exposePattern)) {
    exposes.push({
      value: Number(match[1]),
      line: lineNumber(text, match.index),
    });
  }

  assert.ok(
    exposes.length > 0,
    'backend/Dockerfile has no numeric EXPOSE declaration. Edit backend/Dockerfile to declare the service port.',
  );
  return exposes;
}

function parseServerPortDefault(text) {
  const matches = [...text.matchAll(/\b(?:const|let|var)[ \t]+PORT[ \t]*=[ \t]*process\.env\.PORT[ \t]*\|\|[ \t]*(\d+)\b/g)];
  assert.ok(
    matches.length > 0,
    'backend/server.js does not expose a parseable process.env.PORT || <port> default. Edit backend/server.js before changing deployment port declarations.',
  );
  return Number(matches[0][1]);
}

function parseServerRoutes(text) {
  const routes = [];
  const routePattern = /\bapp\.(?:get|post|put|patch|delete|head|options)[ \t]*\([ \t]*(['"])(\/[^'"]*)\1/g;

  for (const match of text.matchAll(routePattern)) {
    routes.push(match[2]);
  }
  return routes;
}

test('Docker Node major matches every CI node-version entry', () => {
  const dockerfile = readRepoFile('backend/Dockerfile');
  const workflow = readRepoFile('.github/workflows/ci.yml');
  const dockerBases = parseDockerNodeBases(dockerfile);
  const ciVersions = parseCiNodeVersions(workflow);
  const reference = dockerBases[0];

  for (const base of dockerBases.slice(1)) {
    assert.equal(
      base.major,
      reference.major,
      `backend/Dockerfile FROM node:${base.tag} at line ${base.line} has major ${base.major}, but its first Node base is node:${reference.tag} with major ${reference.major}. Edit backend/Dockerfile so every Node base uses one major.`,
    );
  }

  // Check every occurrence: ci.yml has one pin per job, and any one can drift.
  for (const [index, version] of ciVersions.entries()) {
    assert.equal(
      version.major,
      reference.major,
      `backend/Dockerfile FROM node:${reference.tag} has major ${reference.major}, but .github/workflows/ci.yml node-version occurrence ${index + 1} at line ${version.line} is ${JSON.stringify(version.value)} with major ${version.major}. Edit backend/Dockerfile or that ci.yml node-version entry so the pins agree.`,
    );
  }
});

test('package.json promises no less Node than the suite actually runs on', () => {
  const packageText = readRepoFile('backend/package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(packageText);
  } catch (error) {
    assert.fail(`backend/package.json is not valid JSON, so engines.node cannot be checked. Edit backend/package.json. ${error.message}`);
  }

  const engine = packageJson.engines?.node;
  assert.equal(
    typeof engine,
    'string',
    `backend/package.json engines.node is ${JSON.stringify(engine)}, not a present string. Edit backend/package.json to declare the supported Node range.`,
  );

  const nodeEngineRange = /^(?:(?:[<>=~^]+[ \t]*)?v?\d+(?:\.(?:\d+|x|\*)){0,2})(?:[ \t]+(?:(?:[<>=~^]+[ \t]*)?v?\d+(?:\.(?:\d+|x|\*)){0,2}))*(?:[ \t]*\|\|[ \t]*(?:(?:[<>=~^]+[ \t]*)?v?\d+(?:\.(?:\d+|x|\*)){0,2})(?:[ \t]+(?:(?:[<>=~^]+[ \t]*)?v?\d+(?:\.(?:\d+|x|\*)){0,2}))*)*$/i;
  assert.match(
    engine.trim(),
    nodeEngineRange,
    `backend/package.json engines.node is ${JSON.stringify(engine)}, which is not a parseable Node semver range. Edit backend/package.json.`,
  );

  /* THE FLOOR IS NOW ENFORCED, and the reason it was not is worth keeping.
   *
   * It read `>=18.0.0` while CI tested only 26 and the Dockerfile pinned 22 —
   * three declarations, no two agreeing, and a manifest promising support for
   * eight Node majors nobody had ever run the suite on. This test deliberately
   * did NOT enforce a floor at the time, because Render reads this field to
   * choose the production runtime and nobody had verified which majors that
   * service offers: raising it on an assumption is a build that fails to boot.
   *
   * The owner authorised the change on 2026-08-14. It is enforced from here so
   * the three cannot drift apart again — but note what the enforcement is: the
   * floor must not be BELOW the version actually tested. A higher floor is
   * still the owner's call and passes.
   *
   * IF A RENDER BUILD FAILS AFTER THIS: that is this line. Render keeps the
   * previous deployment alive when a new one fails, so the failure is visible
   * and non-destructive — lower the floor to a major Render offers and lower
   * ci.yml and the Dockerfile with it, together. */
  const floor = Number(engine.trim().match(/(\d+)/)?.[1]);
  const ciMajor = parseCiNodeVersions(readRepoFile('.github/workflows/ci.yml'))[0].major;
  assert.ok(
    Number.isFinite(floor) && floor >= ciMajor,
    `backend/package.json engines.node is ${JSON.stringify(engine)}, whose floor is ${floor}, but the suite only ever runs on Node ${ciMajor}. `
      + 'Edit backend/package.json to promise no less than what is tested, or lower the CI pin deliberately.',
  );
});

test('Fly, Docker, and server port declarations stay aligned', () => {
  const fly = readRepoFile('backend/fly.toml');
  const dockerfile = readRepoFile('backend/Dockerfile');
  const server = readRepoFile('backend/server.js');
  const envSection = tomlSection(fly, '[env]');
  const httpSection = tomlSection(fly, '[http_service]');

  assert.ok(envSection, 'backend/fly.toml is missing [env]. Edit backend/fly.toml before changing PORT.');
  assert.ok(httpSection, 'backend/fly.toml is missing [http_service]. Edit backend/fly.toml before changing internal_port.');

  const declarations = [
    { label: 'backend/fly.toml [env] PORT', value: parseTomlInteger(envSection, 'backend/fly.toml [env] PORT', 'PORT') },
    { label: 'backend/fly.toml [http_service] internal_port', value: parseTomlInteger(httpSection, 'backend/fly.toml [http_service] internal_port', 'internal_port') },
    ...parseDockerExposes(dockerfile).map((entry, index) => ({
      label: `backend/Dockerfile EXPOSE occurrence ${index + 1} at line ${entry.line}`,
      value: entry.value,
    })),
    { label: 'backend/server.js process.env.PORT || default', value: parseServerPortDefault(server) },
  ];
  const reference = declarations[0];

  for (const declaration of declarations.slice(1)) {
    assert.equal(
      declaration.value,
      reference.value,
      `${reference.label} is ${reference.value}, but ${declaration.label} is ${declaration.value}. Edit ${reference.label.split(' ')[0]} or ${declaration.label.split(' ')[0]} so all deployment port declarations match.`,
    );
  }
});

test('Fly health check targets a route defined by server.js', () => {
  const fly = readRepoFile('backend/fly.toml');
  const server = readRepoFile('backend/server.js');
  const checksSection = tomlSection(fly, '[[http_service.checks]]');

  assert.ok(
    checksSection,
    'backend/fly.toml is missing [[http_service.checks]]. Edit backend/fly.toml to declare the health check.',
  );
  const healthPath = parseTomlString(checksSection, 'backend/fly.toml health-check path', 'path');
  const routes = parseServerRoutes(server);

  assert.ok(
    routes.includes(healthPath),
    `backend/fly.toml health-check path ${JSON.stringify(healthPath)} is not defined by backend/server.js (routes found: ${routes.join(', ') || 'none'}). Edit backend/fly.toml or define the matching route in backend/server.js.`,
  );
});
