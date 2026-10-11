; =============================================================================
; 「班集」Windows 安装器脚本（Inno Setup 6 / 7）
; -----------------------------------------------------------------------------
; 用途：把 electron-builder 产出的“未打包目录”（release4\win-unpacked）压成
;       单个安装包 exe，并使用完全自定义的安装界面。
;
; 编译方式（需先安装 Inno Setup 6 或 7）：
;   ISCC.exe electron\inno\setup.iss
; 或由 package.json 的 electron-build 脚本在 electron-builder --dir 之后自动调用。
;
; 自定义界面（见 [Code] 段）：
;   - 一个自绘的安装页，全部元素水平/垂直居中：
;       1) logo（居中）
;       2) 标题「安装 班集 测试版」（居中）
;       3) 「安装路径」+ 圆角输入框 + 「浏览...」按钮
;       4) 「我已阅读并同意《用户协议》」勾选框
;   - 点击勾选框弹出「用户协议」弹窗：点「同意」关闭并勾选；点「不同意」仅关闭、不勾选。
;
; 说明：
;   - 相对路径均以本 .iss 文件所在目录（electron\inno）为基准：..\ 即 electron 目录，..\.. 即工程根目录；
;   - 图像（wizard-large.bmp / wizard-small.bmp）已刻意不含发布者署名文字；
;   - 用户协议全文沿用 electron\installer-assets\license.txt（含 UTF-8 BOM）。
; =============================================================================

; ---- 版本号：需与 package.json 的 version 保持一致 -------------------------
#define MyAppVersion "0.8.0"
#define MyAppExeName "班集.exe"

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
; C:\Program Files；注意这会让安装/升级都弹出 UAC（用户已明确要求）。
DefaultDirName={autopf}\班集
DefaultGroupName=班集
DisableProgramGroupPage=yes
; 请求管理员权限：点击安装包即弹 UAC
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible

; 输出：固定文件名「班集-Setup-x.y.z.exe」，便于更新逻辑按资产名匹配（*-Setup-*.exe）
OutputDir=..\..\release4
OutputBaseFilename=班集-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
SetupLogging=yes
; 安装期间若已安装同名版本，直接覆盖升级（无需先卸载）
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
; 整目录拷贝 electron-builder 的未打包产物（release4\win-unpacked）
Source: "..\..\release4\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\班集"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 班集"; Filename: "{uninstallexe}"
Name: "{autodesktop}\班集"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

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
  Gap1, Gap2, Gap3, BlockH, Top0, RowTop: Integer;
  FieldW, BtnW, LabelW, RowLeft, CheckW: Integer;
  Measure: TNewStaticText;
begin
  ExtractTemporaryFile('app-icon.png');
  ExtractTemporaryFile('field-bg.png');
  ExtractTemporaryFile('license.txt');

  { 自绘安装页：空标题/副标题，避免与居中大标题重复 }
  CustomPage := CreateCustomPage(wpWelcome, '', '');
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

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = CustomPage.ID then
  begin
    { 首次显示时去掉输入框原生边框（此时控件句柄才真正创建） }
    if not EditFixed then
    begin
      MakeBorderlessEdit(PathEdit);
      EditFixed := True;
    end;
    WizardForm.NextButton.Caption := '安装';
    WizardForm.NextButton.Enabled := LicenseCheck.Checked;
  end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = wpSelectDir) or (PageID = wpSelectTasks);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = CustomPage.ID then
  begin
    if not LicenseCheck.Checked then
    begin
      Result := False;
      Exit;
    end;
    { 把我们自绘的输入框内容同步给真正的安装目录控件 }
    WizardForm.DirEdit.Text := PathEdit.Text;
  end;
end;