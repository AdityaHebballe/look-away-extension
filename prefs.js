import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gst from 'gi://Gst';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

let previewPipeline = null;
let previewBus = null;
let previewBusWatchId = null;

function playPreview(filePath) {
    if (!Gst.is_initialized())
        Gst.init(null);

    stopPreview();

    previewPipeline = Gst.ElementFactory.make('playbin', 'look-away-preview-player');
    previewPipeline.uri = `file://${filePath}`;
    previewBus = previewPipeline.get_bus();
    previewBus.add_signal_watch();
    previewBusWatchId = previewBus.connect('message', (_bus, message) => {
        const type = message.type;
        if (type === Gst.MessageType.EOS || type === Gst.MessageType.ERROR)
            stopPreview();
    });
    previewPipeline.set_state(Gst.State.PLAYING);
}

function stopPreview() {
    if (!previewPipeline)
        return;

    if (previewBusWatchId) {
        previewBus.remove_signal_watch();
        previewBus.disconnect(previewBusWatchId);
        previewBusWatchId = null;
    }

    previewBus = null;
    previewPipeline.set_state(Gst.State.NULL);
    previewPipeline = null;
}

export default class LookAwayPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'dialog-information-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: 'Timer Settings',
        });

        const intervalRow = new Adw.SpinRow({
            title: 'Reminder Interval',
            subtitle: 'Time between reminders (in minutes)',
        });
        const intervalAdjustment = new Gtk.Adjustment({
            lower: 1,
            upper: 1440,
            step_increment: 1,
            page_increment: 5,
        });
        intervalRow.adjustment = intervalAdjustment;
        group.add(intervalRow);

        const osdRow = new Adw.SwitchRow({
            title: 'Show On-Screen Display',
            subtitle: 'Pop up an indicator on the screen saying "Look Away!"',
        });
        group.add(osdRow);

        const notificationRow = new Adw.SwitchRow({
            title: 'Show Notification',
            subtitle: 'Also send a GNOME notification reminder',
        });
        group.add(notificationRow);

        const audioRow = new Adw.SwitchRow({
            title: 'Play Audio',
            subtitle: 'Play the reminder sound out loud',
        });
        group.add(audioRow);

        const testAudioRow = new Adw.ActionRow({
            title: 'Test Audio Settings',
            subtitle: 'Click to test audio sound output',
        });

        const testButton = new Gtk.Button({
            label: 'Test',
            valign: Gtk.Align.CENTER,
            css_classes: ['pill']
        });
        testButton.connect('clicked', () => {
            try {
                const soundPath = this.dir.get_child('look-away.ogg').get_path();
                playPreview(soundPath);
            } catch (e) {
                console.error(`[Look Away Extension] Failed to play audio: ${e}`);
            }
        });

        testAudioRow.add_suffix(testButton);
        group.add(testAudioRow);

        settings.bind('interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-osd', osdRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-notification', notificationRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('play-audio', audioRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        page.add(group);
        window.add(page);
    }
}
