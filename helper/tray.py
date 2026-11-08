"""Console-free Windows entry point. No browser trust secret is ever logged."""
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import filedialog, messagebox
import webbrowser
import winreg
import pystray
from PIL import Image, ImageDraw
from storage import Store

URL = 'https://khisanthax.github.io/Speed-Printer/'
APP_NAME = 'Speed Printer'


def discover_executable():
    # Running installation takes priority over registered/standard installations.
    try:
        result = subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',
            "Get-Process -Name 'orca-slicer' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -Unique"],
            capture_output=True, text=True, timeout=8, creationflags=subprocess.CREATE_NO_WINDOW)
        paths = [Path(p.strip()) for p in result.stdout.splitlines() if p.strip()]
        if len(paths) == 1 and paths[0].is_file(): return str(paths[0])
    except (OSError,subprocess.TimeoutExpired): pass
    for hive in (winreg.HKEY_CURRENT_USER,winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive,r'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\orca-slicer.exe') as key:
                value = winreg.QueryValueEx(key,'')[0]
                if Path(value).is_file(): return value
        except OSError: pass
    return str(Path(os.environ.get('ProgramFiles',r'C:\Program Files')) / 'OrcaSlicer' / 'orca-slicer.exe')


class Instance:
    def __init__(self):
        kernel = ctypes.windll.kernel32
        kernel.CreateMutexW.argtypes=[ctypes.c_void_p,wintypes.BOOL,wintypes.LPCWSTR]
        kernel.CreateMutexW.restype=wintypes.HANDLE
        kernel.CreateEventW.argtypes=[ctypes.c_void_p,wintypes.BOOL,wintypes.BOOL,wintypes.LPCWSTR]
        kernel.CreateEventW.restype=wintypes.HANDLE
        kernel.SetEvent.argtypes=[wintypes.HANDLE]
        kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD]
        kernel.CloseHandle.argtypes=[wintypes.HANDLE]
        name = 'Local\\SpeedPrinter-' + hashlib.sha256(str(Path.home()).encode()).hexdigest()[:20]
        self.mutex=kernel.CreateMutexW(None,False,name)
        self.existing=kernel.GetLastError()==183
        self.event=kernel.CreateEventW(None,False,False,name+'-activate')
        if self.existing: kernel.SetEvent(self.event)
    def wait(self):return ctypes.windll.kernel32.WaitForSingleObject(self.event,500)==0
    def close(self):
        for handle in (self.event,self.mutex):ctypes.windll.kernel32.CloseHandle(handle)


def copy_code(text):
    user, kernel = ctypes.windll.user32, ctypes.windll.kernel32
    kernel.GlobalAlloc.argtypes=[wintypes.UINT,ctypes.c_size_t];kernel.GlobalAlloc.restype=wintypes.HANDLE
    kernel.GlobalLock.argtypes=[wintypes.HANDLE];kernel.GlobalLock.restype=ctypes.c_void_p
    kernel.GlobalUnlock.argtypes=[wintypes.HANDLE]
    kernel.GlobalFree.argtypes=[wintypes.HANDLE]
    user.SetClipboardData.argtypes=[wintypes.UINT,wintypes.HANDLE];user.SetClipboardData.restype=wintypes.HANDLE
    raw=(text+'\0').encode('utf-16-le');handle=kernel.GlobalAlloc(0x42,len(raw))
    if not handle:raise ctypes.WinError()
    pointer=kernel.GlobalLock(handle)
    if not pointer:kernel.GlobalFree(handle);raise ctypes.WinError()
    ctypes.memmove(pointer,raw,len(raw));kernel.GlobalUnlock(handle)
    for _ in range(10):
        if user.OpenClipboard(None):break
        time.sleep(.05)
    else:kernel.GlobalFree(handle);raise RuntimeError('Clipboard busy; try again')
    try:
        user.EmptyClipboard()
        if not user.SetClipboardData(13,handle):kernel.GlobalFree(handle);raise ctypes.WinError()
    finally:user.CloseClipboard()


def startup(enabled):
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Run') as key:
        if enabled:
            if getattr(sys,'frozen',False): command=f'"{sys.executable}"'
            else: command=f'"{Path(sys.executable).with_name("pythonw.exe")}" "{Path(__file__).resolve()}"'
            winreg.SetValueEx(key,'SpeedPrinter',0,winreg.REG_SZ,command)
        else:
            try:winreg.DeleteValue(key,'SpeedPrinter')
            except FileNotFoundError:pass


class Tray:
    def __init__(self,store,args,instance):
        from server import State, LocalServer, handler_for
        self.store,self.args,self.instance=store,args,instance
        self.root=tk.Tk();self.root.withdraw();self.window=None
        self.error='';self.last_status='';self.stopping=False
        self.state=State(args,store=store)
        self.server=LocalServer(('127.0.0.1',8377),handler_for(self.state))
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
        def ui(action):return lambda *_:self.root.after(0,action)
        menu=pystray.Menu(
            pystray.MenuItem('Open Speed Printer',ui(lambda:webbrowser.open(URL))),
            pystray.MenuItem('Connection Status',ui(self.settings)),
            pystray.MenuItem('Copy Pairing Code',ui(self.copy)),
            pystray.MenuItem('Settings',ui(self.settings),default=True),
            pystray.MenuItem('Restart Helper',ui(self.restart)),
            pystray.MenuItem('Exit',ui(self.exit)))
        self.icon=pystray.Icon('SpeedPrinter',self.image('#e5b341'),APP_NAME,menu)
        self.icon.run_detached()
        self.root.after(500,self.tick)
    def image(self,color):
        im=Image.new('RGBA',(64,64),(0,0,0,0));d=ImageDraw.Draw(im)
        d.rounded_rectangle((6,9,55,57),radius=6,fill='#202a34',outline='white',width=3)
        d.rectangle((16,3,45,27),fill='white');d.rectangle((16,38,44,60),fill='white')
        d.ellipse((42,40,63,61),fill=color,outline='#202a34',width=2)
        return im
    def status(self):
        if self.error:return 'Error · '+self.error,'#ef6262'
        if not self.state.trust.clients:return 'Pairing required','#e5b341'
        if time.time()-self.state.trust.last_connected < 30:return 'Connected','#58c78d'
        return 'Disconnected · trusted browsers will reconnect','#a6aeba'
    def tick(self):
        if self.stopping:return
        if self.instance.wait():self.settings()
        text,color=self.status()
        if text!=self.last_status:
            self.icon.title=f'{APP_NAME} · {text}'[:127];self.icon.icon=self.image(color);self.last_status=text
        if self.window and self.window.winfo_exists():self.status_label.config(text=text)
        self.root.after(1000,self.tick)
    def copy(self):
        try:
            copy_code(self.state.trust.pairing_code());self.error=''
            self.icon.notify('Pairing code copied. Paste it in Speed Printer Settings within five minutes.','Speed Printer')
        except Exception:self.error='Could not copy pairing code'
    def settings(self):
        if self.window and self.window.winfo_exists():
            self.window.deiconify();self.window.lift();self.window.focus_force();return
        w=self.window=tk.Toplevel(self.root);w.title('Speed Printer · Settings');w.geometry('660x410')
        w.attributes('-topmost',True)
        self.status_label=tk.Label(w,text=self.status()[0],font=('Segoe UI',13));self.status_label.pack(pady=12)
        tk.Label(w,text='Loopback only · 127.0.0.1:8377\nClosing this window keeps the tray helper running.').pack()
        fields={}
        for key,label,value in [('orca','OrcaSlicer executable',self.args.orca),('dataDir','Orca data directory',str(self.state.library.directory)),('accountDir','Account folder override (optional)',self.store.data.get('accountDir',''))]:
            row=tk.Frame(w);row.pack(fill='x',padx=12,pady=4)
            tk.Label(row,text=label,width=28,anchor='w').pack(side='left')
            var=tk.StringVar(value=value);fields[key]=var
            tk.Entry(row,textvariable=var).pack(side='left',fill='x',expand=True)
            def browse(k=key,v=var):
                path=filedialog.askopenfilename(parent=w,filetypes=[('OrcaSlicer','*.exe')]) if k=='orca' else filedialog.askdirectory(parent=w)
                if path:v.set(path)
            tk.Button(row,text='Browse',command=browse).pack(side='right')
        enabled=tk.BooleanVar(value=self.store.data.get('startup',False))
        tk.Checkbutton(w,text='Start with Windows (off by default)',variable=enabled).pack(pady=6)
        def save():
            values={k:v.get().strip() for k,v in fields.items()}
            if not Path(values['orca']).is_file():messagebox.showerror(APP_NAME,'Choose an existing Orca executable.',parent=w);return
            startup(enabled.get());self.store.update(**values,startup=enabled.get());self.args.orca=values['orca']
            self.restart()
        def revoke():
            if messagebox.askyesno(APP_NAME,'Revoke every paired browser? Each browser must pair again.',parent=w):
                self.state.trust.revoke();self.state.read_permission=False
                self.store.update(profilePermission=False)
        row=tk.Frame(w);row.pack(pady=12)
        tk.Button(row,text='Copy Pairing Code',command=self.copy).pack(side='left',padx=4)
        tk.Button(row,text='Revoke all browser trust',command=revoke).pack(side='left',padx=4)
        tk.Button(row,text='Save settings',command=save).pack(side='left',padx=4)
        tk.Button(row,text='Close',command=w.destroy).pack(side='left',padx=4)
        tk.Label(w,text='Default view uses enabled system printers and saved user presets.\nPortable installs: select their data directory; choose account only if discovery is ambiguous.',wraplength=610).pack()
    def busy(self):return any(j['state'] in ('pending','running') for j in self.state.jobs.values())
    def restart(self):
        if self.busy():
            messagebox.showinfo(APP_NAME,'Wait for slicing to finish before restarting.',parent=self.window or self.root);return
        from server import State,LocalServer,handler_for
        try:
            self.server.shutdown();self.server.server_close();self.state.pool.shutdown()
            self.state=State(self.args,store=self.store)
            self.server=LocalServer(('127.0.0.1',8377),handler_for(self.state))
            threading.Thread(target=self.server.serve_forever,daemon=True).start();self.error=''
        except Exception:self.error='Restart failed; exit and relaunch the helper'
    def exit(self):
        if self.busy() and not messagebox.askyesno(APP_NAME,'Slicing is running. Exit after the current work finishes?',parent=self.window or self.root):return
        self.stopping=True
        def stop():
            self.server.shutdown();self.server.server_close();self.state.pool.shutdown(wait=True);self.icon.stop();self.root.after(0,self.root.quit)
        threading.Thread(target=stop,daemon=True).start()
    def run(self):
        self.root.mainloop();self.root.destroy()


def main():
    instance=Instance()
    if instance.existing:instance.close();return
    try:
        store=Store(Path(os.environ.get('LOCALAPPDATA',Path.home()))/'SpeedPrinter')
        parser=argparse.ArgumentParser(description=__doc__)
        parser.add_argument('--orca',default=store.data.get('orca') or discover_executable())
        parser.add_argument('--origin',action='append',default=['http://127.0.0.1:5173','http://127.0.0.1:4173','https://khisanthax.github.io'])
        Tray(store,parser.parse_args(),instance).run()
    except Exception:
        # Don't emit private state, file paths or pairing material in a traceback.
        root=tk.Tk();root.withdraw()
        messagebox.showerror(APP_NAME,'Helper could not start. Another helper may own port 8377, or protected local state could not be read. Close an older console helper and retry. Your saved state has not been reset.',parent=root)
        root.destroy()
    finally:instance.close()


if __name__=='__main__':main()
