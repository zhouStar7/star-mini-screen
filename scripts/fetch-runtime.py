#!/usr/bin/env python3
"""Fetch pinned official Node runtimes, verifying SHA256 before extracting selected files."""
from pathlib import Path
import json,hashlib,tarfile,urllib.request,os
root=Path(__file__).resolve().parents[1]
lock=json.loads((root/'runtime.lock.json').read_text())
cache=root/'.cache';cache.mkdir(exist_ok=True)
for arch in ['arm64','x64']:
    name=f'node-v{lock["version"]}-darwin-{arch}'
    archive=cache/(name+'.tar.gz')
    if not archive.exists():
        urllib.request.urlretrieve(f'https://nodejs.org/dist/v{lock["version"]}/{name}.tar.gz',archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=lock[arch]:
        raise SystemExit(f'Checksum mismatch: {archive.name}; remove it and retry')
    folder=cache/'runtime'/arch;folder.mkdir(parents=True,exist_ok=True)
    with tarfile.open(archive,'r:gz') as tar:
        for item,target in [('bin/node','node'),('LICENSE','LICENSE')]:
            source=tar.extractfile(name+'/'+item)
            if source is None:raise SystemExit('Missing official runtime file')
            (folder/target).write_bytes(source.read())
    (folder/'node').chmod(0o755)
print('Verified official Node runtimes for arm64 and x64')
