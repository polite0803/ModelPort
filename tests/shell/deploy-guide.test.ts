import { test } from 'node:test'
import assert from 'node:assert/strict'

import { deployGuideHtml } from '../../src/shell/deployGuide.ts'
import { parseRelease, type ReleaseInfo } from '../../src/shell/updatePlan.ts'

function releaseFixture(options: { checksums?: boolean; docker?: boolean } = {}): ReleaseInfo {
  const assets: { name: string; browser_download_url: string; size: number }[] = []
  for (const arch of ['x64', 'arm64']) {
    const name = `modelport-daemon-1.7.6-${arch}.tar.gz`
    assets.push({ name, browser_download_url: `https://downloads.example.com/${name}`, size: 1024 })
    if (options.checksums !== false) {
      assets.push({ name: `${name}.sha256`, browser_download_url: `https://downloads.example.com/${name}.sha256`, size: 80 })
    }
    if (options.docker !== false) {
      const dockerName = `modelport-daemon-1.7.6-docker-${arch}.tar.gz`
      assets.push({ name: dockerName, browser_download_url: `https://downloads.example.com/${dockerName}`, size: 2048 })
      if (options.checksums !== false) {
        assets.push({ name: `${dockerName}.sha256`, browser_download_url: `https://downloads.example.com/${dockerName}.sha256`, size: 80 })
      }
    }
  }
  return parseRelease({
    tag_name: 'v1.7.6',
    html_url: 'https://github.com/polite0803/ModelPort/releases/tag/v1.7.6',
    assets,
  })
}

test('the guide hands over both architectures, their checksums and the full command path', () => {
  const html = deployGuideHtml({ name: '机房网关', url: 'https://gw.example.com:8443', release: releaseFixture() })
  for (const arch of ['x64', 'arm64']) {
    assert.ok(html.includes(`https://downloads.example.com/modelport-daemon-1.7.6-${arch}.tar.gz`), arch)
    assert.ok(html.includes(`modelport-daemon-1.7.6-${arch}.tar.gz.sha256`), `${arch} checksum`)
  }
  assert.ok(html.includes('sha256sum -c modelport-daemon-1.7.6-x64.tar.gz.sha256'))
  assert.ok(html.includes('tar -xzf modelport-daemon-1.7.6-x64.tar.gz -C /opt/modelport --strip-components=1'))
  assert.ok(html.includes('ExecStart=/usr/bin/node /opt/modelport/modelport-daemon.cjs'))
  assert.ok(html.includes('systemctl enable modelport'))
  assert.ok(html.includes('--init-host --port 8080'))
  assert.ok(html.includes('MODELPORT_HANDSHAKE'))
  assert.ok(html.includes('https://downloads.example.com/modelport-daemon-1.7.6-docker-x64.tar.gz'))
  assert.ok(html.includes('modelport-daemon-1.7.6-docker-arm64.tar.gz.sha256'))
  assert.ok(html.includes('docker load -i modelport-daemon-1.7.6-docker-x64.tar.gz'))
  assert.ok(html.includes('docker volume create modelport-data'))
  assert.ok(html.includes('docker run --rm -v modelport-data:/data modelport-daemon:1.7.6 --init-host --port 8080'))
  assert.ok(html.includes('--restart unless-stopped'))
})

test('a release without Docker assets points at the systemd path instead', () => {
  const html = deployGuideHtml({ name: 'g', url: 'https://gw.example.com', release: releaseFixture({ docker: false }) })
  assert.ok(html.includes('这个发布没有 Docker 镜像资产'))
  assert.equal(html.includes('docker load -i'), false)
})

test('Docker artifacts without checksums are named as undeployable, with no docker commands', () => {
  const html = deployGuideHtml({ name: 'g', url: 'https://gw.example.com', release: releaseFixture({ checksums: false }) })
  assert.ok(html.includes('modelport-daemon-1.7.6-docker-x64.tar.gz：缺资产或 .sha256，不能部署'))
  assert.equal(html.includes('docker load -i'), false)
})

test('entry text is HTML-escaped, never interpolated raw', () => {
  const html = deployGuideHtml({
    name: '<img src=x onerror=alert(1)>',
    url: 'https://gw.example.com/"><script>alert(2)</script>',
    release: releaseFixture(),
  })
  assert.equal(html.includes('<img src=x'), false)
  assert.equal(html.includes('<script>alert(2)</script>'), false)
  assert.ok(html.includes('&lt;img src=x'))
})

test('an artifact without its checksum is named as undeployable, with no commands', () => {
  const html = deployGuideHtml({ name: 'g', url: 'https://gw.example.com', release: releaseFixture({ checksums: false }) })
  assert.ok(html.includes('不能部署'))
  assert.equal(html.includes('sha256sum -c'), false)
  assert.equal(html.includes('--init-host'), false)
})

test('a failed release fetch degrades to the release page, keeping the reason visible', () => {
  const html = deployGuideHtml({
    name: 'g',
    url: 'https://gw.example.com',
    release: null,
    error: 'HTTP 403 <rate limited>',
  })
  assert.ok(html.includes('HTTP 403 &lt;rate limited&gt;'))
  assert.ok(html.includes('https://github.com/polite0803/ModelPort/releases'))
  assert.equal(html.includes('sha256sum -c'), false)
})