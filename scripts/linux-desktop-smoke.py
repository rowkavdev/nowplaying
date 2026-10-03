#!/usr/bin/env python3
"""CI real GTK tray protocol coverage, not a real desktop rendering test."""
import os
import socket
import subprocess
import tempfile
import time
import http.client
from pathlib import Path
import gi
gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

XML = '''<node><interface name="org.kde.StatusNotifierWatcher">
<method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method>
<property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
<property name="ProtocolVersion" type="i" access="read"/>
</interface></node>'''
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
bus.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName", GLib.Variant("(su)", ("org.kde.StatusNotifierWatcher", 0)), None, Gio.DBusCallFlags.NONE, -1, None)
registered = []
def method(_connection, sender, _path, _interface, _name, parameters, invocation):
    item = parameters.unpack()[0]
    registered.append((sender, item if item.startswith('/') else '/StatusNotifierItem'))
    invocation.return_value(None)
def prop(_connection, _sender, _path, _iface, name):
    return GLib.Variant('b', True) if name == 'IsStatusNotifierHostRegistered' else GLib.Variant('i', 0)
bus.register_object('/StatusNotifierWatcher', Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0], method, prop, None)
context = GLib.MainContext.default()
def wait_for(check, message, timeout=10):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        while context.pending(): context.iteration(False)
        result = check()
        if result: return result
        time.sleep(.03)
    raise AssertionError(message)
def call(sender, path, interface, name, args):
    return bus.call_sync(sender, path, interface, name, args, None, Gio.DBusCallFlags.NONE, 1000, None).unpack()
def collect(node):
    result = [(node[0], node[1].get('label'))]
    for entry in node[2]:
        result += collect(entry.unpack() if hasattr(entry, 'unpack') else entry)
    return result

with tempfile.TemporaryDirectory(prefix='np-desktop-smoke-') as temp:
    root = Path(temp)
    opened = root / 'opened'
    # Exercise real opener validation/spawn without needing an actual browser.
    opener = root / 'xdg-open'
    opener.write_text('#!/bin/sh\nprintf "%s\\n" "$1" >> "' + str(opened) + '"\n')
    opener.chmod(0o755)
    env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'])
    with (root / 'app.log').open('w+') as log:
        child = subprocess.Popen(['/usr/bin/nowplaying', 'start', '--no-setup'], stdout=log, stderr=log, env=env)
        passed = False
        helpers = []
        try:
            def registration():
                if child.poll() is not None: raise RuntimeError('app exited before registration')
                return registered
            wait_for(registration, 'tray did not register', 20)
            sender, item_path = registered[0]
            url = 'http://127.0.0.1:47832'
            connection = http.client.HTTPConnection('127.0.0.1', 47832, timeout=5)
            try:
                connection.request('GET', '/settings')
                response = connection.getresponse()
                assert response.status == 200
                response.read()
            finally:
                connection.close()
            def active_menu():
                try:
                    props = call(sender, item_path, 'org.freedesktop.DBus.Properties', 'GetAll', GLib.Variant('(s)', ('org.kde.StatusNotifierItem',)))[0]
                    if props.get('Status') != 'Active': return None
                    menu = props['Menu']
                    layout = call(sender, menu, 'com.canonical.dbusmenu', 'GetLayout', GLib.Variant('(iias)', (0, -1, ['label'])))[1]
                    labels = dict((label, key) for key, label in collect(layout) if label)
                    if {'Open Web UI', 'Settings', 'Logs', 'Quit'}.issubset(labels): return menu, labels
                except GLib.Error: pass
            menu, labels = wait_for(active_menu, 'Active tray/menu did not become ready')
            def activate(label):
                call(sender, menu, 'com.canonical.dbusmenu', 'Event', GLib.Variant('(isvu)', (labels[label], 'clicked', GLib.Variant('s', ''), 0)))
            for index, label in enumerate(['Open Web UI', 'Settings', 'Logs'], 1):
                activate(label)
                wait_for(lambda: opened.exists() and len(opened.read_text().splitlines()) >= index, 'menu did not open browser: ' + label)
            # First-run guard must send all three commands to Settings.
            assert opened.read_text().splitlines() == [url + '/settings'] * 3
            children_file = Path(f'/proc/{child.pid}/task/{child.pid}/children')
            helpers = [int(pid) for pid in children_file.read_text().split()]
            assert helpers, 'no helper process observed'
            activate('Quit')
            assert child.wait(timeout=10) == 0, 'Quit did not close app'
            wait_for(lambda: all(not Path(f'/proc/{pid}').exists() for pid in helpers), 'helper remained after Quit')
            with socket.socket() as probe:
                assert probe.connect_ex(('127.0.0.1', 47832)) != 0, 'WebUI port remained open after Quit'
            passed = True
            print('PASS: installed app, Settings, native tray/menu activation, Quit, helper exit, closed port')
        finally:
            if child.poll() is None:
                child.terminate()
                try: child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
            if not passed:
                log.flush()
                log.seek(0)
                print(log.read())
