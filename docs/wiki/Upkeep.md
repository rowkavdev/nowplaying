# Wiki upkeep checklist

The wiki describes the product as shipped. Run through this list whenever a pull request changes something a user can see, so pages cannot silently go stale.

## On every user-facing change

- [ ] Does the change alter a step on any wiki page (setup flow, settings page, tray menu, update behaviour)? Update the page in the same PR.
- [ ] New setting or privacy option: add it to [Privacy and safe configuration](Privacy-and-safe-configuration) and to the dev-build checklist in `docs/testing-dev-build.md`.
- [ ] New provider or output: add its page to the navigation on [Home](Home) and the [Quick start](Quick-Start).
- [ ] New troubleshooting fix: check the symptom is listed on [Troubleshooting](Troubleshooting).
- [ ] Behaviour that only exists in the development build is marked **planned** or **dev build only** until it reaches a stable release.

## Before each stable release

- [ ] Walk the [Quick start](Quick-Start) against the release build on a clean machine.
- [ ] Check every command and link on every page still works.
- [ ] Remove **planned** markers for anything that shipped.
- [ ] Confirm no page shows real server addresses, usernames, tokens or media titles.

## Link conventions

- Wiki pages link to each other with `(Page-Name)` links, not full URLs.
- Deep technical detail stays in the `docs/` folder of the repository; wiki pages link to it rather than copying it.
