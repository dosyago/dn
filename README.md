# :floppy_disk: [DownloadNet (dn)](https://github.com/dosyago/DownloadNet) – Your Offline Web Archive with Full Text Search

![source lines of code](https://sloc.xyz/github/crisdosyago/Diskernet)
![binary downloads](https://img.shields.io/github/downloads/c9fe/22120/total?label=OS%20binary%20downloads)
![visitors+++](https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https%3A%2F%2Fgithub.com%2Fc9fe%2F22120&count_bg=%2379C83D&title_bg=%23555555&icon=&icon_color=%23E7E7E7&title=%28today%2Ftotal%29%20visitors%2B%2B%2B%20since%20Oct%202020&edge_flat=false)
![DownloadNet slogan](https://img.shields.io/badge/%F0%9F%92%BE%20dn-an%20internet%20on%20yer%20disc-hotpink)

Imagine a world where everything you browse online is saved and accessible, even when you're offline. That's the magic of DownloadNet (dn).

## Why dn?

- **Seamless Offline Experience** :earth_africa:: With dn, your offline browsing feels exactly like being online. It hooks directly into your browser, caching every page you visit, so you never lose track of that one article or resource you meant to revisit.
- **Full Text Search** :mag:: Unlike other archiving tools, dn gives you the power to search through your entire archive. No more digging through countless files—just search and find.
- **Completely Private** :lock:: Everything is stored locally on your machine. Browse whatever you want, with the peace of mind that it's all private and secure.

## Getting Started

### 1. **Download a Pre-built Binary (Simplest Option)** :package:
If you’re not familiar with Git or npm, this is the easiest way to get started:

1. **Go to the [Releases Page](https://github.com/dosyago/DownloadNet/releases)**
2. **Download** the binary for your operating system (e.g., Windows, macOS, Linux).
3. **Run** the downloaded file. That’s it! You’re ready to start archiving.

### 2. **Install via npm (For Users Familiar with Command Line)** :rocket:

1. **Open your terminal** (Command Prompt on Windows, Terminal on macOS/Linux).
2. **Install dn globally** with npm:
   ```sh
   npm i -g downloadnet@latest
   ```
3. **Start dn** by typing:
   ```sh
   dn
   ```

> [!NOTE]
> Make sure you have Node.js installed before attempting to use npm. If you're new to npm, see the next section for guidance.

### 3. **New to npm? No Problem!** :bulb:

If you’ve never used npm before, don’t worry—it’s easy to get started.

- **What is npm?** npm is a package manager for Node.js, a JavaScript runtime that allows you to run server-side code. You’ll use npm to install and manage software like dn.
- **Installing Node.js and npm:** The easiest way to install Node.js (which includes npm) is by using Node Version Manager (nvm). This tool allows you to easily install, manage, and switch between different versions of Node.js.

**To install nvm:**

1. **Visit the [nvm GitHub page](https://github.com/nvm-sh/nvm#installing-and-updating)** for installation instructions.
2. **Follow the steps** to install nvm on your system.
3. Once nvm is installed, **install the latest version of Node.js** by running:
   ```sh
   nvm install node
   ```
4. Now you can install dn using npm as described in the section above!

> [!TIP]
> Using nvm allows you to easily switch between Node.js versions and manage your environment more effectively.

### 4. **Build Your Own Binary (For Developers or Power Users)** :hammer_and_wrench:

If you like to tinker and want to build the binary yourself, here’s how:

1. **Download Git:** If you haven’t used Git before, download and install it from [git-scm.com](https://git-scm.com/).
2. **Clone the Repository:**
   ```sh
   git clone https://github.com/dosyago/DownloadNet.git
   ```
3. **Navigate to the Project Directory:**
   ```sh
   cd DownloadNet
   ```
4. **Install Dependencies:**
   ```sh
   npm i
   ```
5. **Build the Binary:**
   ```sh
   npm run build
   ```

6. **Find Your Binary:** The newly built binary will be in the `./build/bin` directory, ready to be executed!

### 5. **Run Directly from the Repository (Quick Start)** :runner:

Want to get dn up and running without building a binary? No problem!

1. **Clone the Repository:**
   ```sh
   git clone https://github.com/dosyago/DownloadNet.git
   ```
2. **Navigate to the Project Directory:**
   ```sh
   cd DownloadNet
   ```
3. **Install Dependencies:**
   ```sh
   npm i
   ```
4. **Start dn:**
   ```sh
   npm start
   ```

And just like that, you’re archiving!

## How It Works

dn runs as an intercepting proxy, hooking into your browser's internal fetch cycle. Once you fire up dn, it automatically configures your browser, and you’re good to go. Everything you browse is archived, and you can choose to save everything or just what you bookmark.

### Modes:

- **Save Mode** :floppy_disk:: Archive and index as you browse.
- **Serve Mode** :open_file_folder:: Browse your saved content as if you were still online.

> [!CAUTION]
> As your archive grows, you may encounter performance issues. If that happens, you can adjust the memory settings by setting environment variables for NODE runtime arguments, like `--max-old-space-size`.

## Accessing Your Archive

Once dn is running, your archive is at your fingertips. Just go to `http://localhost:22120` in your browser. Your archive’s control panel opens automatically, and from there, you can search, configure settings, and explore everything you’ve saved.

## Minimalistic Interface, Maximum Power

dn’s interface is basic but functional. It’s not about flashy design; it’s about delivering what you need—offline access to the web, as if you were still connected.

## Advanced Settings (If Needed)

As your archive grows, you may want to adjust where it's stored, manage memory settings, or blacklist domains you don’t want to archive. All of these settings can be tweaked directly from the control panel or command line.

## Get Started Now

With dn, you’ll never lose track of anything you’ve read online. It’s all right there in your own offline archive, fully searchable and always accessible. Whether you're in save mode or serve mode, dn keeps your digital life intact.

**:arrow_down: Download** | **:rocket: Install** | **:runner: Run** | **:mag_right: Never Lose Anything Again**

[Get Started with dn](https://github.com/dosyago/DownloadNet)

----
