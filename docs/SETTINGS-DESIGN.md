# 设置设计

参照 [DSH Go](https://github.com/ccch1mneyyy/dsh-go) 的安卓实现：`app/lib/ui/theme/motion.dart` 把按压、反馈、展开和页面过渡分级；`common/pressable.dart` 与 `common/expand_reveal.dart` 把节奏落实到重复使用的交互；`settings/settings_widgets.dart` 统一设置行的图标、标题、当前值与操作位置；`settings/appearance/appearance_page.dart` 用小样展示主题。折页借鉴这些原则，未移植它的代码、品牌或手机界面。

## 折页的做法

- 稳定的导航和独立滚动的内容区。宽窗展示分类与当前状态，窄窗和短窗改为顶部分类。切分类不触发原生窗口缩放，不刷新或清空表单。
- 按压 `90 ms`、轻状态 `160 ms`、切类别 `200 ms`、展开 `240 ms`。只有内容和控件在动，尊重系统「减弱动态效果」。
- 用纸色／墨色预览和选中标记保持可辨识性。主题只保存主题；学习预算、时区与胶囊指标分开保存，不会写回旧主题。
- 模型配置是可选项。保留「只保存」和「保存并测试」两个明确动作；地址变更时不会把已保存的旧密钥复用给新地址。导览客户端截图来自未填写密钥的 Windows WebView2。

## 实机图

- [模型连接 · 墨色](../public/guides/deepseek-fold-settings.webp)
- [外观 · 纸色](evidence/settings-appearance-native-2026-11-18.png)

下一步优先把这些交互规则用到离线学习主线：书架条目的选中与展开，以及作答、自评和收下卡片时的反馈。
