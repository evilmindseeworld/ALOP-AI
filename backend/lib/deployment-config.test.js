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

/* ═══════════════════════════════════════════════════════════════════════════
 * WHICH HOST IS LIVE, AND WHO STILL BELIEVES SOMETHING ELSE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Five artefacts described the deployment and they disagreed:
 *
 *   backend/fly.toml          an app in Mumbai that has never served a request
 *   backend/Dockerfile        built for it
 *   .github/workflows/keep-warm.yml   pings Render, with a comment recording
 *                             the week it spent pinging a Fly host that does
 *                             not resolve while reporting itself healthy
 *   frontend/vercel.json      a CSP allowing BOTH origins
 *   (nothing)                 the live host had no configuration in the repo
 *
 * The cost is measured and written up in that workflow: real arrivals paid a
 * 22.5-second cold boot for as long as the warmer was pointed at nothing.
 *
 * deploy/targets.json is now the single declaration and these tests are what
 * make disagreeing with it a red run rather than a silent outage.
 */

const TARGETS = JSON.parse(readRepoFile('deploy/targets.json'));

const hostOf = (origin) => {
  try { return new URL(origin).host; } catch { return null; }
};

test('the live target is fully declared and internally consistent', () => {
  const live = TARGETS.live;
  assert.ok(live && live.host && live.origin, 'deploy/targets.json must name a live host');
  assert.equal(hostOf(live.origin), live.host, 'the live origin and host must agree');
  assert.ok(live.healthPath.startsWith('/'), 'healthPath must be a path');
  assert.ok(
    fs.existsSync(path.join(REPO_ROOT, live.config)),
    `deploy/targets.json names ${live.config} as the live host's configuration and it does not exist`,
  );
});

test('the keep-warm job pings the host that is actually live', () => {
  const workflow = readRepoFile('.github/workflows/keep-warm.yml');
  const fallback = workflow.match(/URL="\$\{KEEP_WARM_URL:-([^"}]+)\}"/);
  assert.ok(fallback, 'keep-warm.yml no longer has a parseable default URL');
  const url = fallback[1];
  assert.equal(
    hostOf(url),
    TARGETS.live.host,
    `keep-warm.yml defaults to ${url}, which is not the live host in deploy/targets.json. `
    + 'This exact mismatch went unnoticed for a week and cost every cold arrival 22.5 seconds.',
  );
  assert.ok(url.endsWith(TARGETS.live.healthPath), 'the warmer must hit the declared health path');
});

/* A CSP origin for a host that does not exist is not harmless: it is a claim
 * that the frontend talks to that host, and the next person reading it will
 * believe the claim. The Fly origin sat here for the whole time the Fly app did
 * not resolve. */
test('the frontend may only connect to hosts this repository declares', () => {
  const vercel = JSON.parse(readRepoFile('frontend/vercel.json'));
  const rule = vercel.headers.find((h) => h.source === '/(.*)');
  const csp = rule.headers.find((h) => h.key === 'Content-Security-Policy').value;
  const connect = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('connect-src'));
  assert.ok(connect, 'no connect-src in the frontend CSP');

  const backendOrigins = connect
    .split(/\s+/)
    .slice(1)
    .filter((v) => /^https?:\/\//.test(v))
    // Third parties are declared by the frontend's own source, and
    // securityHeaders.test.js already checks those. This test is about OUR hosts.
    .filter((v) => /alop-ai/.test(v) && !/clerk/.test(v));

  assert.deepEqual(
    backendOrigins,
    [TARGETS.live.origin],
    'the frontend CSP must allow exactly the live backend origin. A prepared-but-undeployed '
    + 'host in here reads as "the app talks to this", and one of them did not resolve at all.',
  );
});

test('the live host config, Fly and server.js agree on the health path', () => {
  const live = TARGETS.live;
  const render = readRepoFile('render.yaml');
  const renderHealth = render.match(/^\s*healthCheckPath:\s*(\S+)\s*$/m);
  assert.ok(renderHealth, 'render.yaml has no healthCheckPath');
  assert.equal(renderHealth[1], live.healthPath);

  const fly = readRepoFile('backend/fly.toml');
  const flyHealth = fly.match(/^\s*path\s*=\s*"([^"]+)"\s*$/m);
  assert.ok(flyHealth, 'fly.toml has no health check path');
  assert.equal(
    flyHealth[1], live.healthPath,
    'the prepared host checks a different path from the live one, so a cutover would change '
    + 'what "healthy" means at the moment nobody is watching',
  );

  const server = readRepoFile('backend/server.js');
  assert.ok(
    server.includes(`app.get('${live.healthPath}'`),
    `${live.healthPath} is checked by two hosts and defined by neither`,
  );
});

test('every declared Node major is the one deploy/targets.json names', () => {
  const declared = TARGETS.runtime.nodeMajor;
  const docker = parseDockerNodeBases(readRepoFile('backend/Dockerfile'));
  for (const base of docker) assert.equal(base.major, declared, `backend/Dockerfile line ${base.line}`);
  for (const v of parseCiNodeVersions(readRepoFile('.github/workflows/ci.yml'))) {
    assert.equal(v.major, declared, `.github/workflows/ci.yml line ${v.line}`);
  }
  const render = readRepoFile('render.yaml').match(/^\s*nodeVersion:\s*"?v?(\d+)/m);
  assert.ok(render, 'render.yaml does not pin a Node version, so the live host can upgrade under us');
  assert.equal(Number(render[1]), declared);
  const engines = JSON.parse(readRepoFile('backend/package.json')).engines.node;
  assert.ok(engines.replace(/\s+/g, "").includes(`>=${declared}`), `package.json engines is ${engines}`);
});

/* THE REGION IS A LATENCY DECISION, not a preference, and fly.toml argues it at
 * length from measurements taken in Dubai. What must not happen is the two
 * configs quietly describing different geography while one comment explains a
 * migration that has not occurred. */
test('the prepared host is marked as not resolving until it does', () => {
  const prepared = TARGETS.prepared.find((p) => p.platform === 'fly');
  assert.ok(prepared, 'fly.toml exists in the repo and is not declared in deploy/targets.json');
  const fly = readRepoFile('backend/fly.toml');
  assert.ok(fly.includes(`primary_region = "${prepared.region}"`), `fly.toml region is not ${prepared.region}`);
  if (prepared.resolves === false) {
    const workflow = readRepoFile('.github/workflows/keep-warm.yml');
    assert.ok(
      !workflow.includes(`KEEP_WARM_URL:-https://${prepared.host}`),
      'the warmer defaults to a host declared as not resolving',
    );
  }
});
