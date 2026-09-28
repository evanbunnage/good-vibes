<div align="center">

# <picture><source media="(prefers-color-scheme: dark)" srcset="packaging/logo-dark.svg"><img src="packaging/logo-light.svg" height="72" alt="CoolSwitch"></picture>

Command-Tab between windows (not apps) on macOS. Supports apps that use native tabs like [Ghostty](https://ghostty.org).

</div>

## How is this different from AltTab?

[AltTab](https://alt-tab.app/) is great if you want more features like window previews and deep customizability. Go check it out!

CoolSwitch remains a more lightweight alternative for users who simply want the core alt-tab behavior from Windows.

## Install

**[Download CoolSwitch.zip](https://github.com/evanbunnage/good-vibes/releases/download/coolswitch-latest/CoolSwitch.zip)**, unzip it, and open **CoolSwitch.app**.

## Using CoolSwitch

- Hold ⌘ and press Tab to view open windows.
- While holding ⌘, press Shift to move backward in the list.
- Release ⌘ (or press Return) to switch the window. Press Escape to cancel.

Supports arrow key navigation, native tabs, minimized windows and apps with no open windows.

CoolSwitch will detect what macOS desktop your windows are on and display the corresponding number. If you use [AeroSpace](https://github.com/nikitabobko/AeroSpace) to manage windows, it will show the windows' AeroSpace workspace instead.

**Settings:** reopen CoolSwitch to view the settings page.

## Updating

Download the latest `CoolSwitch.zip` and open the new **CoolSwitch.app**. Choose **Update**.

## Uninstalling

- Quit the app and move it to the Trash.
- To remove its Accessibility entry, go to System Settings → Privacy & Security → Accessibility, select CoolSwitch, and click `−`.

## Privacy

CoolSwitch uses its permissions to read window titles, handle ⌘Tab, and focus windows. The app makes no network requests, collects no analytics, and doesn't take screenshots.

## Why "CoolSwitch"?

Windows 3.1's Alt-Tab implementation internally was known as [CoolSwitch](https://en.wikipedia.org/wiki/Alt-Tab#History)!

## Build from source

Requires Xcode 26 or newer.

```sh
swift test
./scripts/build-app.sh
open dist/CoolSwitch.app
```

Regenerate the icon with `uv run packaging/make-icon.py`.

## Release

```sh
gh workflow run coolswitch.yml --repo evanbunnage/good-vibes --ref main -f version=X.Y.Z
```

## Acknowledgments
- [AltTab](https://github.com/lwouis/alt-tab-macos) for paving the way
- Codex macOS team for the nice [onboarding inspo](https://x.com/trpfsu/status/2044882275100250444) 
- [permiso](https://github.com/zats/permiso) for reverse engineering Codex-y onboarding


## License

[MIT](LICENSE)
