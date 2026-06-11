/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Enforce allowed scopes — must match CONTRIBUTING.md §3
    'scope-enum': [
      2, // error level: 2 = error
      'always',
      [
        'web',       // web/ UI — frontend-engineer
        'api',       // web/src/app/api, web/prisma — backend-engineer
        'contracts', // contracts/ — contracts-engineer
        'infra',     // docker-compose, CI, root config — devops-engineer
        'e2e',       // end-to-end tests — devops-engineer
        'docs',      // documentation — documentation-engineer
        'delivery',  // docs/delivery, CONTRIBUTING — devops-engineer
        'deps',      // dependency bumps (any agent)
      ],
    ],
    // Scope is required (not optional) — prevents "feat: thing" with no scope
    'scope-empty': [2, 'never'],
    // Subject must not end with a period
    'subject-full-stop': [2, 'never', '.'],
    // Subject must be present
    'subject-empty': [2, 'never'],
    // Body and footer are optional but if present must be separated by blank line (default)
    // Header max length 100 chars
    'header-max-length': [2, 'always', 100],
  },
};
