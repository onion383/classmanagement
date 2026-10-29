; =============================================================================
; 「班集」Windows 安装器脚本（Inno Setup 6 / 7）
; -----------------------------------------------------------------------------
; 用途：把 electron-builder 产出的“未打包目录”（{#AppDir}\win-unpacked）压成
;       单个安装包 exe，并使用完全自定义的安装界面。
;
; 编译方式（需先安装 Inno Setup 6 或 7）：
;   ISCC.exe electron\inno\setup.iss
; 或由 package.json 的 electron-build 脚本在 electron-builder --dir 之后自动调用。
;
; 自定义界面（见 [Code] 段）：
;   - 低版本系统提示页（仅当系统低于 Windows 10 1709 且未勾选过「不再提示」时出现）：
;       1) logo（居中）
;       2) 标题「班集」（居中）
;       3) 红色提示文案（居中，自动换行）
;       4) 「获取最新的 Windows」链接（居中，点开默认浏览器访问系统下载页并退出安装程序）
;       5) 「不再提示」勾选框，勾选即在 %LocalAppData%\班集\ 写当前用户标记文件
;          （SkipOsVersionWarning.flag）
;     底部按钮复用向导按钮：「退出程序」（左，高亮）与「忽略」（右）。
;   - 一个自绘的安装页，全部元素水平/垂直居中：
;       1) logo（居中）
;       2) 标题「安装 班集 测试版」（居中）
;       3) 「安装路径」+ 圆角输入框 + 「浏览...」按钮
;       4) 「我已阅读并同意《用户协议》」勾选框
;   - 点击勾选框弹出「用户协议」弹窗：点「同意」关闭并勾选；点「不同意」仅关闭、不勾选。
;
; 说明：
;   - 低版本系统提示页预览：给安装包加命令行参数 /OSWARN=1 可无条件展示该页
;     （应用内对应环境变量 OS_WARN_FORCE=1）。
;   - 相对路径均以本 .iss 文件所在目录（electron\inno）为基准：..\ 即 electron 目录，..\.. 即工程根目录；
;   - 图像（wizard-large.bmp / wizard-small.bmp）已刻意不含发布者署名文字；
;   - 用户协议全文沿用 electron\installer-assets\license.txt（含 UTF-8 BOM）。
; =============================================================================

; ---- 版本号：需与 package.json 的 version 保持一致 -------------------------
#define MyAppVersion "0.8.0"
#define MyAppExeName "班集.exe"

; ---- 打包输出目录名 --------------------------------------------------------
; 两条通道各用各的目录，安装包不会互相覆盖：
;   正式版（npm run electron:build）       → release
;   Vue 3.6 预览（npm run electron:buildnew）→ release36
; 由 electron/inno/compile.mjs 用 ISCC 的 /DAppDir=xxx 覆盖；
; 直接双击/手跑 ISCC.exe 时走下面的默认值 release。
#ifndef AppDir
  #define AppDir "release"
#endif

[Setup]
; AppId 写死为固定 GUID，切勿更改——它决定“同一应用的升级/卸载识别”，
; 每次变化会导致生成新的独立安装项、旧版不被覆盖。
AppId={{C3F1A9B2-4D5E-4F60-8A7B-1C2D3E4F5A6B}
AppName=班集
AppVersion={#MyAppVersion}
AppVerName=班集 {#MyAppVersion}
AppPublisher=无聊的小洋葱
AppPublisherURL=https://github.com/onion383/classmanagement
AppSupportURL=https://github.com/onion383/classmanagement
AppUpdatesURL=https://github.com/onion383/classmanagement/releases
VersionInfoVersion={#MyAppVersion}

; 安装到系统 Program Files（需管理员权限）。{autopf} 在 64 位安装模式下解析为
; C:\Program Files，安装时会请求 UAC。
DefaultDirName={autopf}\班集
DefaultGroupName=班集
DisableProgramGroupPage=yes
; 默认权限模式：请求管理员权限（会弹 UAC）
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible

; 输出：固定文件名「班集-Setup-x.y.z.exe」，便于更新逻辑按资产名匹配（*-Setup-*.exe）
OutputDir=..\..\{#AppDir}
OutputBaseFilename=班集-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
SetupLogging=yes
; 沿用上次的安装目录（机器级 Program Files\班集），同一 AppId 下可直接覆盖升级。
UsePreviousAppDir=yes

; ---- 图标 -------------------------------------------------------------------
SetupIconFile=..\installer-assets\installer.ico
UninstallDisplayIcon={app}\{#MyAppExeName}

; ---- 页面裁剪：欢迎 / 目录 / 就绪页全部不要，改用自绘安装页 ------------------
; 目录页与任务页通过 [Code] 的 ShouldSkipPage 跳过（保留控件以便代码读取/写入安装路径）。
DisableWelcomePage=yes
DisableReadyPage=yes

; ---- modern 观感向导 --------------------------------------------------------
; WizardStyle=modern 使用左侧大图（164x314）与右上角小图（55x55），界面更现代清爽。
WizardStyle=modern
WizardImageFile=wizard-large.bmp
WizardSmallImageFile=wizard-small.bmp
WizardImageStretch=no

; ---- 升级必备：静默安装时自动关闭旧进程、装完自动重启 ----------------------
CloseApplications=yes
RestartApplications=yes

; 防止多个安装实例并发（用 ASCII 名，免 UAC 下不涉及 Global 命名空间权限）
SetupMutex=campus-assistant-setup

[Languages]
; Inno 6/7 自带简体中文语言文件
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"; Flags: checkedonce

[Files]
; 自绘界面用到的运行时资源（不落盘到安装目录，仅解压到临时目录供 [Code] 读取）。
; 关键：必须排在应用文件之前——使其位于固实压缩流的“开头”。
; 否则它们落在流末尾，InitializeWizard 里的 ExtractTemporaryFile 会被迫解压
; 整条 300MB+ 的固实流（lzma2/max 约 4~9 秒），导致安装程序启动极慢。
; nocompression 让这三个小文件不参与压缩、单独存储，读取无需触碰大流。
Source: "..\app-icon.png"; DestDir: "{tmp}"; Flags: dontcopy nocompression
Source: "..\installer-assets\field-bg.png"; DestDir: "{tmp}"; Flags: dontcopy nocompression
Source: "..\installer-assets\license.txt"; DestDir: "{tmp}"; Flags: dontcopy nocompression
; 整目录拷贝 electron-builder 的未打包产物（{#AppDir}\win-unpacked）
; Excludes：不把 .gitignore 装进安装目录
Source: "..\..\{#AppDir}\win-unpacked\*"; DestDir: "{app}"; Excludes: ".gitignore"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\班集"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 班集"; Filename: "{uninstallexe}"
Name: "{autodesktop}\班集"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[UninstallDelete]
; 低版本系统提示页的「不再提示」开关：由 [Code] 在 %ProgramData%\班集\ 下写一个
; 机器级标记文件（SkipOsVersionWarning.flag），卸载时在此清理。
Type: files; Name: "{commonappdata}\班集\SkipOsVersionWarning.flag"

[Run]
; 安装完成后可选启动（静默安装时跳过）
Filename: "{app}\{#MyAppExeName}"; Description: "启动 班集"; Flags: nowait postinstall skipifsilent

[Code]
const
  GWL_STYLE = -16;
  GWL_EXSTYLE = -20;
  WS_BORDER = $00800000;
  WS_EX_CLIENTEDGE = $00000200;
  SWP_NOSIZE = $0001;
  SWP_NOMOVE = $0002;
  SWP_NOZORDER = $0004;
  SWP_FRAMECHANGED = $0020;
  { 低版本系统判定阈值：Windows 10 1709 的 build 号 }
  OS_WARN_MIN_BUILD = 16299;
  { 「不再提示」的机器级标记文件目录/文件名（%ProgramData%\班集\） }
  OS_WARN_FLAG_DIR = '{commonappdata}\班集';
  OS_WARN_FLAG_FILE = 'SkipOsVersionWarning.flag';
  { 提示文案用色：柔和红 #B91C1C（TColor 为 BGR 排列） }
  OS_WARN_TEXT_COLOR = $1C1CB9;
  { 「获取最新的 Windows」打开的下载页 }
  OS_DOWNLOAD_URL = 'https://www.microsoft.com/zh-cn/software-download/windows11';

function GetWindowLong(hWnd: HWND; nIndex: Integer): Longint;
  external 'GetWindowLongW@user32.dll stdcall';
function SetWindowLong(hWnd: HWND; nIndex: Integer; dwNewLong: Longint): Longint;
  external 'SetWindowLongW@user32.dll stdcall';
function SetWindowPos(hWnd: HWND; hWndInsertAfter: HWND; X, Y, cx, cy: Integer;
  uFlags: UINT): BOOL;
  external 'SetWindowPos@user32.dll stdcall';

var
  CustomPage: TWizardPage;
  LogoImage: TBitmapImage;
  TitleLabel: TNewStaticText;
  PathLabel: TNewStaticText;
  FieldBg: TBitmapImage;
  PathEdit: TNewEdit;
  BrowseButton: TNewButton;
  LicenseCheck: TNewCheckBox;
  EditFixed: Boolean;
  { 重入守卫：程序化修改 Checked 会再次触发 OnClick，用它阻断递归弹窗 }
  LicenseOpening: Boolean;

  { ---- 低版本系统提示页 ---- }
  OsWarnPage: TWizardPage;
  OsWarnLogo: TBitmapImage;
  OsWarnTitle: TNewStaticText;
  OsWarnMsg: TNewStaticText;
  OsWarnGetWin: TNewLinkLabel;
  OsWarnRemember: TNewCheckBox;
  { 是否需要展示提示页：低于 Win10 1709 且用户未勾选过「不再提示」 }
  OsWarningNeeded: Boolean;
  { 向导「取消」按钮的原始文案：提示页临时改成「退出程序」，切回安装页时还原。
    注意：DFM 里三个向导按钮的文案只是占位符 '*'，真实文案由 Inno 在切换页面时才填入，
    所以不能在 InitializeWizard 里读取——要等进入提示页时（文案已填好）再记下。 }
  OrigCancelCaption: String;
  { 是否已把「取消」临时改成「退出程序」：只有改过才需要在安装页还原 }
  CancelCaptionOverridden: Boolean;
  { 点「获取最新的 Windows」时置位：跳过退出确认框，直接关闭安装程序 }
  SkipExitConfirm: Boolean;

{ 去掉输入框的原生边框（WS_BORDER / WS_EX_CLIENTEDGE），让它融入圆角背景图 }
procedure MakeBorderlessEdit(const AEdit: TNewEdit);
var
  L: Longint;
begin
  L := GetWindowLong(AEdit.Handle, GWL_STYLE);
  SetWindowLong(AEdit.Handle, GWL_STYLE, L and (not WS_BORDER));
  L := GetWindowLong(AEdit.Handle, GWL_EXSTYLE);
  SetWindowLong(AEdit.Handle, GWL_EXSTYLE, L and (not WS_EX_CLIENTEDGE));
  SetWindowPos(AEdit.Handle, 0, 0, 0, 0, 0,
    SWP_NOSIZE or SWP_NOMOVE or SWP_NOZORDER or SWP_FRAMECHANGED);
end;

{ 系统是否低于 Windows 10 1709：非 Win10（Win7/8.1 等）一律算低；Win10 则比 build 号 }
function IsOsVersionTooLow(): Boolean;
var
  V: TWindowsVersion;
begin
  GetWindowsVersionEx(V);
  if V.Major > 10 then
    Result := False
  else if V.Major = 10 then
    Result := V.Build < OS_WARN_MIN_BUILD
  else
    Result := True;
end;

{ 用户是否已勾选过「不再提示」：检查机器级标记文件是否存在（卸载时由 [UninstallDelete] 清理）。
  改用标记文件而非注册表：在 [Code] 里调用 RegValueExists 时，根键常量（HKEY_*/HKA）
  的类型与 RootKey: Integer 形参不匹配，运行时会直接抛「Type Mismatch」。 }
function OsWarnSkipped(): Boolean;
begin
  Result := FileExists(ExpandConstant(OS_WARN_FLAG_DIR + '\' + OS_WARN_FLAG_FILE));
end;

{ 「不再提示」勾选框：勾选即写标记文件，取消勾选即删除，下次运行安装包据此跳过提示页。
  写到 ProgramData（机器级）。 }
procedure OsWarnRememberClick(Sender: TObject);
var
  Dir, FlagPath: String;
begin
  Dir := ExpandConstant(OS_WARN_FLAG_DIR);
  FlagPath := Dir + '\' + OS_WARN_FLAG_FILE;
  if OsWarnRemember.Checked then
  begin
    ForceDirectories(Dir);
    SaveStringToFile(FlagPath, '1', False);
  end
  else
    DeleteFile(FlagPath);
end;

{ 点「获取最新的 Windows」：用默认浏览器打开系统下载页，随后直接退出安装程序。
  用 ShellExecAsOriginalUser：安装包已改为免提权运行，该函数此时等价于 ShellExec，
  保留它没有副作用（万一以后又改回管理员模式也不用再动这里）。 }
procedure OsWarnGetWinClick(Sender: TObject; const Link: string; LinkType: TSysLinkType);
var
  ErrorCode: Integer;
  URL: String;
begin
  if LinkType = sltURL then
    URL := Link
  else
    URL := OS_DOWNLOAD_URL;
  if not ShellExecAsOriginalUser('open', URL, '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode) then
    MsgBox('未能打开浏览器，请手动访问：' + URL, mbError, MB_OK);
  { 置位后由 CancelButtonClick 跳过退出确认框，静默关闭 }
  SkipExitConfirm := True;
  WizardForm.Close;
end;

{ 用户协议弹窗：点「同意」返回 True（mrYes），点「不同意」返回 False（mrNo） }
function ShowLicenseDialog(): Boolean;
var
  Form: TSetupForm;
  Memo: TNewMemo;
  BtnAgree, BtnDisagree: TNewButton;
  Lines: TArrayOfString;
  BtnW, I: Integer;
begin
  Result := False;
  { 尺寸与安装向导窗口保持一致：按“客户区”对齐，使两个窗口的外框尺寸完全相同 }
  Form := CreateCustomForm(ScaleX(1), ScaleY(1), False, False);
  Form.ClientWidth := WizardForm.ClientWidth;
  Form.ClientHeight := WizardForm.ClientHeight;
  try
    Form.Caption := '用户协议';

    Memo := TNewMemo.Create(Form);
    Memo.Parent := Form;
    Memo.Left := ScaleX(12);
    Memo.Top := ScaleY(12);
    Memo.Width := Form.ClientWidth - ScaleX(24);
    Memo.Height := Form.ClientHeight - ScaleY(12 + 25 + 12 + 12);
    Memo.ScrollBars := ssVertical;
    Memo.ReadOnly := True;
    if LoadStringsFromFile(ExpandConstant('{tmp}\license.txt'), Lines) then
    begin
      Memo.Lines.Clear;
      for I := 0 to GetArrayLength(Lines) - 1 do
        Memo.Lines.Add(Lines[I]);
    end
    else
      Memo.Lines.Text := '未能加载用户协议文件，请检查安装包完整性。';

    BtnW := Form.CalculateButtonWidth(['同意', '不同意']);

    BtnDisagree := TNewButton.Create(Form);
    BtnDisagree.Parent := Form;
    BtnDisagree.Caption := '不同意';
    BtnDisagree.ModalResult := mrNo;
    BtnDisagree.Width := BtnW;
    BtnDisagree.Height := ScaleY(25);
    BtnDisagree.Left := Form.ClientWidth - ScaleX(12) - BtnDisagree.Width;
    BtnDisagree.Top := Form.ClientHeight - ScaleY(12) - BtnDisagree.Height;

    BtnAgree := TNewButton.Create(Form);
    BtnAgree.Parent := Form;
    BtnAgree.Caption := '同意';
    BtnAgree.ModalResult := mrYes;
    BtnAgree.Default := True;
    BtnAgree.Width := BtnW;
    BtnAgree.Height := BtnDisagree.Height;
    BtnAgree.Left := BtnDisagree.Left - ScaleX(8) - BtnAgree.Width;
    BtnAgree.Top := BtnDisagree.Top;

    Form.ActiveControl := BtnAgree;
    Form.FlipAndCenterIfNeeded(True, WizardForm, False);

    Result := Form.ShowModal() = mrYes;
  finally
    Form.Free();
  end;
end;

{ 勾选框点击：不直接切换，而是弹协议；仅「同意」才勾上（「不同意」保持未勾选） }
procedure LicenseCheckClick(Sender: TObject);
begin
  { 程序化修改 Checked 会再次触发本 OnClick；用守卫保证只处理一次 }
  if LicenseOpening then
    Exit;
  LicenseOpening := True;
  try
    LicenseCheck.Checked := False;
    if ShowLicenseDialog() then
      LicenseCheck.Checked := True;
    WizardForm.NextButton.Enabled := LicenseCheck.Checked;
  finally
    LicenseOpening := False;
  end;
end;

{ 「浏览...」：选择安装目录并写回输入框 }
procedure BrowseButtonClick(Sender: TObject);
var
  Dir: String;
begin
  Dir := PathEdit.Text;
  if BrowseForFolder('请选择安装目录', Dir, True) then
    PathEdit.Text := Dir;
end;

procedure InitializeWizard();
var
  SW, SH, LogoSize, TitleH, RowH, CheckH: Integer;
  Gap1, Gap2, Gap3, Gap4, BlockH, Top0, RowTop: Integer;
  FieldW, BtnW, LabelW, RowLeft, CheckW, MsgH, LinkH, LinkW: Integer;
  Measure: TNewStaticText;
begin
  ExtractTemporaryFile('app-icon.png');
  ExtractTemporaryFile('field-bg.png');
  ExtractTemporaryFile('license.txt');

  { ---------- 低版本系统提示页（排在安装页之前；版本达标或已勾选「不再提示」时跳过） ---------- }
  { 调试/预览用：命令行加 /OSWARN=1 时无条件展示提示页（忽略系统版本与「不再提示」） }
  if Pos('/OSWARN', Uppercase(GetCmdTail())) > 0 then
    OsWarningNeeded := True
  else
    OsWarningNeeded := IsOsVersionTooLow() and (not OsWarnSkipped());

  OsWarnPage := CreateCustomPage(wpWelcome, '', '');
  SW := OsWarnPage.Surface.Width;
  SH := OsWarnPage.Surface.Height;

  LogoSize := ScaleX(88);
  TitleH := ScaleY(32);
  CheckH := ScaleY(18);
  Gap1 := ScaleY(16);
  Gap2 := ScaleY(26);
  Gap3 := ScaleY(24);
  MsgH := ScaleY(58);
  LinkH := ScaleY(20);
  Gap4 := ScaleY(8);

  BlockH := LogoSize + Gap1 + TitleH + Gap2 + MsgH + Gap3 + LinkH + Gap4 + CheckH;
  Top0 := (SH - BlockH) div 2;
  if Top0 < ScaleY(10) then
    Top0 := ScaleY(10);

  { 1) logo（水平居中） }
  OsWarnLogo := TBitmapImage.Create(OsWarnPage);
  OsWarnLogo.Parent := OsWarnPage.Surface;
  OsWarnLogo.AutoSize := False;
  OsWarnLogo.Stretch := True;
  OsWarnLogo.Width := LogoSize;
  OsWarnLogo.Height := LogoSize;
  OsWarnLogo.Left := (SW - LogoSize) div 2;
  OsWarnLogo.Top := Top0;
  OsWarnLogo.PngImage.LoadFromFile(ExpandConstant('{tmp}\app-icon.png'));

  { 2) 标题「班集」（水平居中） }
  OsWarnTitle := TNewStaticText.Create(OsWarnPage);
  OsWarnTitle.Parent := OsWarnPage.Surface;
  OsWarnTitle.AutoSize := False;
  OsWarnTitle.WordWrap := False;
  OsWarnTitle.Alignment := taCenter;
  OsWarnTitle.Left := 0;
  OsWarnTitle.Width := SW;
  OsWarnTitle.Height := TitleH;
  OsWarnTitle.Top := Top0 + LogoSize + Gap1;
  OsWarnTitle.Font.Size := 15;
  OsWarnTitle.Font.Style := [fsBold];
  OsWarnTitle.Caption := '班集';

  { 3) 提示正文（居中、自动换行、警示红字） }
  OsWarnMsg := TNewStaticText.Create(OsWarnPage);
  OsWarnMsg.Parent := OsWarnPage.Surface;
  OsWarnMsg.AutoSize := False;
  OsWarnMsg.WordWrap := True;
  OsWarnMsg.Alignment := taCenter;
  OsWarnMsg.Left := ScaleX(6);
  OsWarnMsg.Width := SW - ScaleX(12);
  OsWarnMsg.Height := MsgH;
  OsWarnMsg.Top := Top0 + LogoSize + Gap1 + TitleH + Gap2;
  OsWarnMsg.Font.Size := 10;
  OsWarnMsg.Font.Color := OS_WARN_TEXT_COLOR;
  OsWarnMsg.Caption :=
    '检测到您正在运行的系统版本过低，可能导致软件异常或崩溃，' +
    '建议将系统升级到 Windows 10 1709 或更高版本';

  { 4) 「获取最新的 Windows」链接（居中；点击用默认浏览器打开下载页并退出安装程序）
     注意：TNewLinkLabel 内部是 Windows SysLink 控件，Caption 必须写成 <a ...>文字</a>
     这种锚点标记才会渲染成可点链接；传纯文本时整段文字都不可点，点击毫无反应。 }
  Measure := TNewStaticText.Create(OsWarnPage);
  Measure.Parent := OsWarnPage.Surface;
  Measure.AutoSize := True;
  Measure.Caption := '获取最新的 Windows';
  LinkW := Measure.Width;
  Measure.Free;

  OsWarnGetWin := TNewLinkLabel.Create(OsWarnPage);
  OsWarnGetWin.Parent := OsWarnPage.Surface;
  OsWarnGetWin.AutoSize := False;
  { 按量出的文字宽度水平居中（SysLink 自己绘制，不依赖 Alignment） }
  OsWarnGetWin.Left := (SW - LinkW) div 2;
  OsWarnGetWin.Width := LinkW;
  OsWarnGetWin.Height := LinkH;
  OsWarnGetWin.Top := Top0 + LogoSize + Gap1 + TitleH + Gap2 + MsgH + Gap3;
  OsWarnGetWin.UseVisualStyle := True;
  OsWarnGetWin.Caption := '<a href="' + OS_DOWNLOAD_URL + '">获取最新的 Windows</a>';
  OsWarnGetWin.OnLinkClick := @OsWarnGetWinClick;

  { 5) 「不再提示」勾选框（水平居中） }
  Measure := TNewStaticText.Create(OsWarnPage);
  Measure.Parent := OsWarnPage.Surface;
  Measure.AutoSize := True;
  Measure.Caption := '不再提示';
  CheckW := Measure.Width + ScaleX(22);
  Measure.Free;

  OsWarnRemember := TNewCheckBox.Create(OsWarnPage);
  OsWarnRemember.Parent := OsWarnPage.Surface;
  OsWarnRemember.Caption := '不再提示';
  OsWarnRemember.Width := CheckW;
  OsWarnRemember.Top := Top0 + LogoSize + Gap1 + TitleH + Gap2 + MsgH + Gap3 + LinkH + Gap4;
  OsWarnRemember.Left := (SW - CheckW) div 2;
  OsWarnRemember.OnClick := @OsWarnRememberClick;

  { ---------- 自绘安装页 ---------- }
  { 自绘安装页：空标题/副标题，避免与居中大标题重复。
    注意：CreateCustomPage 是「紧跟 AfterID 之后插入」，若这里仍用 wpWelcome，
    安装页会插到提示页之前、顺序颠倒；故锚在提示页之后。 }
  CustomPage := CreateCustomPage(OsWarnPage.ID, '', '');
  SW := CustomPage.Surface.Width;
  SH := CustomPage.Surface.Height;

  LogoSize := ScaleX(88);
  TitleH := ScaleY(32);
  RowH := ScaleY(32);
  CheckH := ScaleY(18);
  Gap1 := ScaleY(16);
  Gap2 := ScaleY(26);
  Gap3 := ScaleY(24);

  { 竖直居中：先算内容块总高，再取居中起点 }
  BlockH := LogoSize + Gap1 + TitleH + Gap2 + RowH + Gap3 + CheckH;
  Top0 := (SH - BlockH) div 2;
  if Top0 < ScaleY(10) then
    Top0 := ScaleY(10);

  { 1) logo（水平居中） }
  LogoImage := TBitmapImage.Create(CustomPage);
  LogoImage.Parent := CustomPage.Surface;
  LogoImage.AutoSize := False;
  LogoImage.Stretch := True;
  LogoImage.Width := LogoSize;
  LogoImage.Height := LogoSize;
  LogoImage.Left := (SW - LogoSize) div 2;
  LogoImage.Top := Top0;
  LogoImage.PngImage.LoadFromFile(ExpandConstant('{tmp}\app-icon.png'));

  { 2) 标题（水平居中） }
  TitleLabel := TNewStaticText.Create(CustomPage);
  TitleLabel.Parent := CustomPage.Surface;
  TitleLabel.AutoSize := False;
  TitleLabel.WordWrap := False;
  TitleLabel.Alignment := taCenter;
  TitleLabel.Left := 0;
  TitleLabel.Width := SW;
  TitleLabel.Height := TitleH;
  TitleLabel.Top := Top0 + LogoSize + Gap1;
  TitleLabel.Font.Size := 15;
  TitleLabel.Font.Style := [fsBold];
  TitleLabel.Caption := '安装 班集 测试版';

  RowTop := Top0 + LogoSize + Gap1 + TitleH + Gap2;

  { 3) 安装路径：标签 + 圆角输入框 + 浏览按钮，整行水平居中 }
  FieldW := ScaleX(260);
  BtnW := ScaleX(78);

  PathLabel := TNewStaticText.Create(CustomPage);
  PathLabel.Parent := CustomPage.Surface;
  PathLabel.AutoSize := True;
  PathLabel.Caption := '安装路径';
  LabelW := PathLabel.Width;

  RowLeft := (SW - (LabelW + ScaleX(10) + FieldW + ScaleX(10) + BtnW)) div 2;
  if RowLeft < ScaleX(8) then
    RowLeft := ScaleX(8);

  PathLabel.Left := RowLeft;
  PathLabel.Top := RowTop + (RowH - PathLabel.Height) div 2;

  FieldBg := TBitmapImage.Create(CustomPage);
  FieldBg.Parent := CustomPage.Surface;
  FieldBg.AutoSize := False;
  FieldBg.Stretch := True;
  FieldBg.Left := RowLeft + LabelW + ScaleX(10);
  FieldBg.Top := RowTop;
  FieldBg.Width := FieldW;
  FieldBg.Height := RowH;
  FieldBg.PngImage.LoadFromFile(ExpandConstant('{tmp}\field-bg.png'));

  PathEdit := TNewEdit.Create(CustomPage);
  PathEdit.Parent := CustomPage.Surface;
  PathEdit.Left := FieldBg.Left + ScaleX(9);
  PathEdit.Width := FieldW - ScaleX(18);
  PathEdit.Top := RowTop + (RowH - PathEdit.Height) div 2;
  PathEdit.Text := ExpandConstant('{autopf}\班集');

  BrowseButton := TNewButton.Create(CustomPage);
  BrowseButton.Parent := CustomPage.Surface;
  BrowseButton.Caption := '浏览...';
  BrowseButton.Left := FieldBg.Left + FieldW + ScaleX(10);
  BrowseButton.Top := RowTop;
  BrowseButton.Width := BtnW;
  BrowseButton.Height := RowH;
  BrowseButton.OnClick := @BrowseButtonClick;

  { 4) 同意用户协议（水平居中） }
  { 用 TNewStaticText 量出文案宽度（它支持 AutoSize），再加上勾选框本体宽度，保证整行居中 }
  Measure := TNewStaticText.Create(CustomPage);
  Measure.Parent := CustomPage.Surface;
  Measure.AutoSize := True;
  Measure.Caption := '我已阅读并同意《用户协议》';
  CheckW := Measure.Width + ScaleX(22);
  Measure.Free;

  LicenseCheck := TNewCheckBox.Create(CustomPage);
  LicenseCheck.Parent := CustomPage.Surface;
  LicenseCheck.Caption := '我已阅读并同意《用户协议》';
  LicenseCheck.Width := CheckW;
  LicenseCheck.Top := RowTop + RowH + Gap3;
  LicenseCheck.Left := (SW - CheckW) div 2;
  LicenseCheck.OnClick := @LicenseCheckClick;
end;

{ 把底部向导按钮（上一步 / 安装 / 取消）排成等宽、等间距的一排：
  Inno 默认按各按钮自身文案单独算宽度，三个文案长短不一（且「上一步」在部分页还隐藏），
  视觉上间距就忽宽忽窄；这里统一取三者所需的最大宽度，再从右往左等距摆放。
  注意：CalculateButtonWidth 的参数是开放数组，只能传「内联数组字面量」[xxx]；
  传静态数组变量会在运行时抛 Type Mismatch，所以这里逐个文案单独量宽取最大值。 }
procedure LayoutWizardButtons();
var
  Gap, Right, W, T: Integer;
begin
  W := 0;
  if WizardForm.BackButton.Visible then
  begin
    T := WizardForm.CalculateButtonWidth([WizardForm.BackButton.Caption]);
    if T > W then
      W := T;
  end;
  if WizardForm.NextButton.Visible then
  begin
    T := WizardForm.CalculateButtonWidth([WizardForm.NextButton.Caption]);
    if T > W then
      W := T;
  end;
  if WizardForm.CancelButton.Visible then
  begin
    T := WizardForm.CalculateButtonWidth([WizardForm.CancelButton.Caption]);
    if T > W then
      W := T;
  end;
  if W <= 0 then
    Exit;

  { 沿用 Inno 自身的右边距：以「取消」按钮右边缘作为整排右边界 }
  Right := WizardForm.CancelButton.Left + WizardForm.CancelButton.Width;
  Gap := ScaleX(8);

  { 从右往左依次摆放：取消 → 安装 → 上一步 }
  if WizardForm.CancelButton.Visible then
  begin
    Right := Right - W;
    WizardForm.CancelButton.Left := Right;
    WizardForm.CancelButton.Width := W;
    Right := Right - Gap;
  end;
  if WizardForm.NextButton.Visible then
  begin
    Right := Right - W;
    WizardForm.NextButton.Left := Right;
    WizardForm.NextButton.Width := W;
    Right := Right - Gap;
  end;
  if WizardForm.BackButton.Visible then
  begin
    Right := Right - W;
    WizardForm.BackButton.Left := Right;
    WizardForm.BackButton.Width := W;
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = OsWarnPage.ID then
  begin
    { 提示页：底部按钮临时改为「退出程序」（左，高亮）/「忽略」（右）。
      进入本页时 Inno 已把「取消」的真实文案填好，此刻记下它以便切回安装页还原；
      只在首次进入时记，避免从安装页返回时把「退出程序」当成原始值记下。 }
    if not CancelCaptionOverridden then
    begin
      OrigCancelCaption := WizardForm.CancelButton.Caption;
      CancelCaptionOverridden := True;
    end;
    WizardForm.NextButton.Caption := '忽略';
    WizardForm.NextButton.Enabled := True;
    WizardForm.NextButton.Default := False;
    WizardForm.CancelButton.Caption := '退出程序';
    WizardForm.CancelButton.Default := True;
    LayoutWizardButtons();
  end
  else if CurPageID = CustomPage.ID then
  begin
    { 首次显示时去掉输入框原生边框（此时控件句柄才真正创建） }
    if not EditFixed then
    begin
      MakeBorderlessEdit(PathEdit);
      EditFixed := True;
    end;
    WizardForm.NextButton.Caption := '安装';
    WizardForm.NextButton.Default := True;
    WizardForm.NextButton.Enabled := LicenseCheck.Checked;
    { 只有提示页临时改过「取消」文案时才还原，否则保持 Inno 自己的文案（不要写回占位符 '*'） }
    if CancelCaptionOverridden then
      WizardForm.CancelButton.Caption := OrigCancelCaption;
    WizardForm.CancelButton.Default := False;
    LayoutWizardButtons();
  end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = wpSelectDir) or (PageID = wpSelectTasks);
  { 低版本提示页仅在「系统过低且未勾选不再提示」时出现 }
  if PageID = OsWarnPage.ID then
    Result := not OsWarningNeeded;
end;

{ 点「退出程序」/关闭向导：提示页上不再弹「确定要退出安装吗」确认框，直接退出 }
procedure CancelButtonClick(CurPageID: Integer; var Cancel, Confirm: Boolean);
begin
  if SkipExitConfirm or (CurPageID = OsWarnPage.ID) then
    Confirm := False;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = CustomPage.ID then
  begin
    { 静默安装（/SILENT、/VERYSILENT，自动更新走的就是这条）下无人勾选协议，
      若仍按未勾选处理会直接 Result:=False，导致整个安装中止（日志：
      Failed to proceed to next wizard page; aborting），故静默时跳过校验。 }
    if (not WizardSilent) and (not LicenseCheck.Checked) then
    begin
      Result := False;
      Exit;
    end;
    { 把我们自绘的输入框内容同步给真正的安装目录控件 }
    WizardForm.DirEdit.Text := PathEdit.Text;
  end;
end;