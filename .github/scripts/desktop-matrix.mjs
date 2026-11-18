// Keep manual presentation releases separate from the normal full release.
const platforms = [
  { os: 'macos-latest', args: '--mac', label: 'macOS', native_args: '', artifact: 'macOS' },
  {
    os: 'windows-latest',
    args: '--win --x64',
    label: 'Windows · x64',
    native_args: '--arch x64',
    artifact: 'Windows-x64',
  },
  {
    os: 'windows-latest',
    args: '--win --ia32',
    label: 'Windows · 32-bit',
    native_args: '--arch ia32',
    artifact: 'Windows-ia32',
  },
];
const roles =
  process.argv[2] === 'presentations' ? ['leader', 'band'] : ['leader', 'band', 'stage'];
console.log(
  JSON.stringify({
    include: roles.flatMap((role) =>
      platforms.map((platform) => ({
        ...platform,
        role,
        config: role === 'leader' ? 'electron-builder.yml' : `electron-builder.${role}.yml`,
        label: `${platform.label} · ${role}`,
        artifact: `worship-archive-${role}-${platform.artifact}`,
      })),
    ),
  }),
);
