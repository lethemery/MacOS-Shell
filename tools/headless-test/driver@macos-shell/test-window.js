import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

const app = new Adw.Application({application_id: 'org.macosshell.TestWindow'});
app.connect('activate', () => {
    const view = new Adw.ToolbarView({
        content: new Adw.StatusPage({title: 'Test window', icon_name: 'applications-system-symbolic'}),
    });
    view.add_top_bar(new Adw.HeaderBar());
    const win = new Adw.ApplicationWindow({application: app, title: 'Test window',
        default_width: 640, default_height: 420, content: view});
    win.present();
});
app.run([]);
