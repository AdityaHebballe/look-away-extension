import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gst from 'gi://Gst';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const INDICATOR_ICON_NAME = 'view-reveal-symbolic';

class AudioPlayer {
    constructor() {
        this._pipeline = null;
        this._bus = null;
        this._busWatchId = null;
    }

    play(filePath) {
        if (!Gst.is_initialized()) {
            try {
                Gst.init(null);
            } catch (error) {
                console.error(`[Look Away Extension] Failed to initialize GStreamer: ${error}`);
                return;
            }
        }

        this.stop();

        this._pipeline = Gst.ElementFactory.make('playbin', 'look-away-player');
        this._pipeline.uri = `file://${filePath}`;
        this._watchPipelineBus();
        this._pipeline.set_state(Gst.State.PLAYING);
    }

    stop() {
        if (!this._pipeline)
            return;

        if (this._busWatchId) {
            this._bus.remove_signal_watch();
            this._bus.disconnect(this._busWatchId);
            this._busWatchId = null;
        }

        this._bus = null;
        this._pipeline.set_state(Gst.State.NULL);
        this._pipeline = null;
    }

    _watchPipelineBus() {
        this._bus = this._pipeline.get_bus();
        this._bus.add_signal_watch();
        this._busWatchId = this._bus.connect('message', (_bus, message) => {
            const type = message.type;
            if (type === Gst.MessageType.EOS || type === Gst.MessageType.ERROR)
                this.stop();
        });
    }
}

export default class LookAwayExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._audioPlayer = new AudioPlayer();

        this._createPanelIndicator();

        this._settingsChangedId = this._settings.connect('changed', () => {
            this._restartSchedule();
        });

        this._restartSchedule();
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        this._clearTick();

        if (this._audioPlayer) {
            this._audioPlayer.stop();
            this._audioPlayer = null;
        }

        if (this._nextReminderItem) {
            this._nextReminderItem.destroy();
            this._nextReminderItem = null;
        }

        if (this._triggerNowItem) {
            this._triggerNowItem.destroy();
            this._triggerNowItem = null;
        }

        if (this._panelButton) {
            this._panelButton.destroy();
            this._panelButton = null;
        }

        this._panelLabel = null;
        this._settings = null;
        this._intervalSecs = 0;
        this._nextReminderAt = 0;
    }

    _createPanelIndicator() {
        this._panelButton = new PanelMenu.Button(0.0, `${this.uuid}-indicator`, false);

        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        const icon = new St.Icon({
            icon_name: INDICATOR_ICON_NAME,
            style_class: 'system-status-icon',
        });

        this._panelLabel = new St.Label({
            text: '--:--',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        box.add_child(icon);
        box.add_child(this._panelLabel);
        this._panelButton.add_child(box);

        this._nextReminderItem = new PopupMenu.PopupMenuItem('', { reactive: false });
        this._triggerNowItem = new PopupMenu.PopupMenuItem('Trigger reminder now');
        this._triggerNowItem.connect('activate', () => {
            this._triggerReminder();
            this._restartSchedule();
        });

        const settingsItem = new PopupMenu.PopupMenuItem('Preferences');
        settingsItem.connect('activate', () => {
            this.openPreferences();
        });

        this._panelButton.menu.addMenuItem(this._nextReminderItem);
        this._panelButton.menu.addMenuItem(this._triggerNowItem);
        this._panelButton.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._panelButton.menu.addMenuItem(settingsItem);

        Main.panel.addToStatusArea(this.uuid, this._panelButton, 0, 'right');
    }

    _restartSchedule() {
        this._clearTick();

        const intervalMins = this._settings.get_int('interval');
        this._intervalSecs = Math.max(0, intervalMins * 60);

        if (this._intervalSecs === 0) {
            this._setCountdownText('Off');
            return;
        }

        this._nextReminderAt = this._nowSeconds() + this._intervalSecs;
        this._updateCountdown();
        this._scheduleNextTick();
    }

    _clearTick() {
        if (!this._tickId)
            return;

        GLib.source_remove(this._tickId);
        this._tickId = null;
    }

    _onTick() {
        if (!this._intervalSecs)
            return;

        const now = this._nowSeconds();
        if (now >= this._nextReminderAt) {
            this._triggerReminder();
            this._nextReminderAt = now + this._intervalSecs;
        }

        this._updateCountdown();
        this._scheduleNextTick();
    }

    _updateCountdown() {
        const remaining = Math.max(0, this._nextReminderAt - this._nowSeconds());
        this._setCountdownText(this._formatRemainingMinutes(remaining));
    }

    _scheduleNextTick() {
        this._clearTick();

        if (!this._intervalSecs)
            return;

        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._tickId = null;
            this._onTick();
            return GLib.SOURCE_REMOVE;
        });
    }

    _setCountdownText(text) {
        if (this._panelLabel)
            this._panelLabel.set_text(text);

        if (this._nextReminderItem)
            this._nextReminderItem.label.text = `Next reminder in ${text}`;
    }

    _triggerReminder() {
        let shouldNotify = this._settings.get_boolean('show-notification');

        if (this._settings.get_boolean('show-osd')) {
            try {
                const icon = new Gio.ThemedIcon({ name: INDICATOR_ICON_NAME });
                if (typeof Main.osdWindowManager.showAll === 'function')
                    Main.osdWindowManager.showAll(icon, 'Look Away!');
                else
                    Main.osdWindowManager.show(-1, icon, 'Look Away!', null, null);
            } catch (error) {
                console.error(`[Look Away Extension] Failed to show OSD: ${error}`);
                shouldNotify = true;
            }
        }

        if (shouldNotify)
            Main.notify('Look Away!', 'Time to rest your eyes.');

        if (this._settings.get_boolean('play-audio')) {
            try {
                const soundPath = this.dir.get_child('look-away.ogg').get_path();
                this._audioPlayer.play(soundPath);
            } catch (error) {
                console.error(`[Look Away Extension] Failed to play audio: ${error}`);
            }
        }
    }

    _formatRemainingMinutes(totalSeconds) {
        const totalMinutes = Math.ceil(totalSeconds / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        if (hours > 0)
            return `${hours}:${String(minutes).padStart(2, '0')}:00`;

        return `${totalMinutes}:00`;
    }

    _nowSeconds() {
        return Math.floor(GLib.get_monotonic_time() / GLib.USEC_PER_SEC);
    }
}
