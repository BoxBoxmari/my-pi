# Search Ignore Semantics

The Node search fallback uses `.gitignore` files to reduce traversal work. It
supports nested ignore files, last-match-wins negation, directory-only rules,
`**` globstar patterns, escaped `#`, `!`, spaces, and backslashes, trailing
unescaped spaces, and root-anchored patterns.

This matcher is intentionally a focused compatibility subset, not a complete
replacement for Git's index/pathspec implementation. It is never a security
boundary: sensitive-path policy is evaluated separately, immediately before a
file or directory is opened or descended into. Hidden dotfiles are skipped by
the search fallback regardless of `.gitignore` rules.
