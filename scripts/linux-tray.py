#!/usr/bin/env python3
"""Native tray bridge. stdout is an event protocol; never holds credentials."""
import os
import signal
import sys


def emit(event):
    print(event, flush=True)


def main():
    import gi
    gi.require_version("Gtk", "3.0")
    try:
        gi.require_version("AyatanaAppIndicator3", "0.1")
        from gi.repository import AyatanaAppIndicator3 as Indicator
    except ValueError:
        gi.require_version("AppIndicator3", "0.1")
        from gi.repository import AppIndicator3 as Indicator
    from gi.repository import Gtk, Gio, GLib

    # A loaded library is not proof that the desktop can display a tray.
    # Don't claim readiness on GNOME without a running indicator host.
    watcher = Gio.DBusProxy.new_for_bus_sync(
        Gio.BusType.SESSION, Gio.DBusProxyFlags.DO_NOT_AUTO_START, None,
        "org.kde.StatusNotifierWatcher", "/StatusNotifierWatcher",
        "org.kde.StatusNotifierWatcher", None)
    hosted = watcher.get_cached_property("IsStatusNotifierHostRegistered")
    if not watcher.get_name_owner() or hosted is None or not hosted.unpack():
        return 2
    if not Gtk.init_check()[0]:
        return 2
    menu = Gtk.Menu()
    for label, event in [("Open Web UI", "open"), ("Settings", "settings"), ("Logs", "logs")]:
        item = Gtk.MenuItem(label=label)
        item.connect("activate", lambda _item, action=event: emit(action))
        menu.append(item)
    menu.append(Gtk.SeparatorMenuItem())
    quit_item = Gtk.MenuItem(label="Quit")
    def quit_app(_item):
        emit("quit")
        Gtk.main_quit()
    quit_item.connect("activate", quit_app)
    menu.append(quit_item)
    menu.show_all()
    indicator = Indicator.Indicator.new("nowplaying", os.path.abspath(sys.argv[1]), Indicator.IndicatorCategory.APPLICATION_STATUS)
    indicator.set_title("NowPlaying")
    indicator.set_menu(menu)
    indicator.set_status(Indicator.IndicatorStatus.ACTIVE)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, lambda: Gtk.main_quit() or False)
    # Parent exit closes stdin. Stop the orphan tray even after a hard crash.
    GLib.io_add_watch(sys.stdin, GLib.IO_HUP, lambda *_: Gtk.main_quit() or False)
    emit("ready")
    Gtk.main()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ImportError, ValueError, RuntimeError, OSError):
        sys.exit(2)
