# 要石 kanameishi

## 简介
要石(kanameishi)是一个基于多重API制作的地震预警和地震信息可视化Web应用，基于Vite+Vue3+Leaflet开发。  
提供基于Tauri构建的Windows、macOS、Linux应用程序，推荐Windows 10、macOS 11、Ubuntu 22.04及以上64位系统使用。其他系统请自行测试兼容性。  
icon是《铃芽之旅》的草太さん（椅子形态）。  
* [Web版](https://kanameishi.lipomoea.tech/)
* [Web版备用](https://kanameishi.pages.dev/)（使用CloudFlare托管，速度更快，但国内可能需要代理访问。）
* [应用程序下载](https://github.com/Lipomoea/kanameishi/releases)
* [应用程序下载（备用）](https://gitee.com/lipomoea/kanameishi/releases)
* [开发者bilibili](https://space.bilibili.com/316757498)
## 主要功能  
* 接收中国地震局（包括各省分局）、台湾省中央气象署、日本气象厅地震预警速报。
* 接收中国地震台网、台湾省中央气象署、日本气象厅地震信息。
* 接收日本气象厅海啸情报。
* 获取NIED強震モニタ、KMA-PEWS测站数据并检测。
## 注意事项
* 本应用程序仅作为学习使用。
* 本应用程序使用非官方数据源，可能出现错误。一切信息请以官方发布为准。
* 本应用程序为永久免费的公益性项目，不接受任何形式的捐赠。任何以本应用程序为名义索取费用的行为均属诈骗。严禁将本应用用于商业场合。
* 首次使用本应用程序时，请详细阅读“帮助&关于”中的内容。
## 常见问题
1. **如何安装/更新kanameishi客户端？**
    1. 确认你的操作系统是64位操作系统。
    2. [下载应用程序](https://github.com/Lipomoea/kanameishi/releases)。
        * Windows (x64)系统请选择以".exe"结尾的文件。
        * Linux (Ubuntu x64)系统请选择以".deb"结尾的文件。
        * macOS (Apple处理器)请选择以"aarch64.dmg"结尾的文件。
        * macOS (Intel处理器)请选择以"x64.dmg"结尾的文件。
        * 未列入上述清单的操作系统请自行测试兼容性。
    3. 安装应用程序。
        * Windows (x64)系统双击启动安装程序，一路点"next"即可完成安装。如您已安装过kanameishi，建议在安装程序中勾选"Uninstall kanameishi"并在下一步**不要勾选**"Delete the application data"，先卸载原来的版本再安装新版本。
        * Linux用户请根据你的系统情况自行安装。
        * macOS用户请双击下载的.dmg文件，将"kanameishi"的图标拖拽到"Applications"文件夹图标内完成安装。如您已安装过kanameishi，可直接选择“替换”。启动应用时如遇“文件损坏”提示，请参考下一条。
2. **macOS提示“kanameishi.app已损坏，无法打开。你应该将它移到废纸篓。”**  
    这是因为macOS默认阻止了从互联网下载的未经苹果官方开发者签名和公证的.app文件。  
    请打开系统终端并输入：
    ```bash
    sudo xattr -cr /Applications/kanameishi.app
    ```
    回车后输入你的用户密码，再次打开kanameishi.app即可正常运行。
3. **Linux系统下软件界面、托盘菜单等出现乱码。**  
    由于Linux系统的高自由度，使用系统自带webview运行的Tauri应用无法给出统一的解决方案。请结合你遇到的问题和系统版本对GPT进行提问获取答案。通常可以通过安装字体库等方法解决。
    ```
    例：[Ubuntu 22.04系统]下Tauri应用出现[xx语言字体乱码/托盘图标乱码/ElementPlus组件字体乱码]问题如何解决？
    ```
## 数据来源
* 地震预警（CEA/SC/FJ/CWA/JMA）、地震信息（CENC）、地震列表（JMA）、IP定位、NTP时间：[Wolfx Open API](https://wolfx.jp/apidoc)（请注意参考接口文档）
* 地震信息（JMA）、海啸信息（JMA）：[P2PQuake](https://www.p2pquake.net/develop/json_api_v2/#/P2P%E5%9C%B0%E9%9C%87%E6%83%85%E5%A0%B1%20API/get_history)
* 地震预警（CEA/SC/FJ/CWA/JMA/KMA）、地震信息（CENC/CWA/KMA/USGS/FSSN）、地震列表（CENC/CWA/FSSN）、CENC烈度速报、自然资源部海啸预警、IP定位、NTP时间：[FAN Studio API](https://api.fanstudio.tech)
* 中国大陆地图：[阿里云DataV.GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector)
* 中国台湾地图：[GeoJSON](https://geojson.cn/)
* 中国断层：[国家地震科学数据中心](https://data.earthquake.cn/datashare/report.shtml?PAGEID=datasourcelist&dt=ff808082845b8fd401845bf036a1000c)
* 中国地图注记：[中国城市经纬度坐标点集](https://gitcode.com/Open-source-documentation-tutorial/a0d83)
* 日本地图：[日本気象庁](https://www.data.jma.go.jp/developer/gis.html)（注意钓鱼岛地区处理）
* 韩国地图：[NGII](https://www.ngii.go.kr/world/mapdownload05_en.html)
* 世界地图：[GeoJSON Maps of the globe](https://geojson-maps.kyd.au/)（注意甄别争议地区）
* SREV音效：[scratch-realtime-earthquake-viewer-page](https://github.com/kotoho7/scratch-realtime-earthquake-viewer-page)
* 中文倒计时播报素材：[地牛Wake Up！](https://eew.earthquake.tw/)
## 参考软件
* [JQuake](https://jquake.net/)
* [scratch-realtime-earthquake-viewer-page](https://github.com/kotoho7/scratch-realtime-earthquake-viewer-page)
* [TREM-Lite](https://github.com/ExpTechTW/TREM-Lite)
## 特别鸣谢
* [lxfly2000](https://github.com/lxfly2000)
* [BasyacatX](https://github.com/BasyacatX)
* [Wolfx Project](https://wolfx.jp/)
* [TBS](https://space.bilibili.com/652050915/)
* [FAN](https://www.fanstudio.tech/)
* [Dxr](https://space.bilibili.com/523564463)
* HomoOS
* [azzbm](https://space.bilibili.com/702013828)
* [不知道要取什么系列](https://space.bilibili.com/499911115)
* [Andyli](https://space.bilibili.com/401770455)
* [PopSlime](https://github.com/PopSlime)
* 各位提供帮助的EEW爱好者
## 版权声明
本项目参考了以下项目的源代码。
* [TREM-Lite](https://github.com/ExpTechTW/TREM-Lite)
* [TREM-tauri](https://github.com/ExpTechTW/TREM-tauri)
* [EarthQuakeWarning](https://github.com/kengwang/EarthQuakeWarning)
* [Zero-Quake](https://github.com/0Quake/Zero-Quake)
## 开放源代码许可
本项目基于[AGPL-3.0](https://github.com/Lipomoea/kanameishi/blob/main/LICENSE)协议授权。
