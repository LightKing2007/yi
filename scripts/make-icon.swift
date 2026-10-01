// 应用图标：极简的圆角方块，正中一个行楷「弈」（与开始菜单、宣传片片名同一款字），右下一方红色「棋」印，配色取自游戏界面。
//   swift scripts/make-icon.swift [方案]      方案：seal（默认，暖白底墨字 + 红印）、paper（暖白底墨字，不带印）、ink（墨底米白字）
// 输出 build-res/icon.png（1024×1024，打包时自动转换成各平台格式）与 public/icon.png（256×256，窗口图标），
// 以及 Windows 安装程序的两张图：build-res/installerSidebar.bmp（欢迎页与完成页左边的竖条）、installerHeader.bmp（其他页右上角）。
// 用 macOS 自带的行楷（Xingkai SC Bold）现画；程序里只带画好的图，不带字体文件。
//   swift scripts/make-icon.swift 方案 输出.png   只画一张 1024 的到指定位置（比较方案用）
import AppKit
import CoreText

func findFont(_ file: String) -> URL? {
    let fm = FileManager.default
    var dirs = ["/System/Library/Fonts/Supplemental", "/System/Library/Fonts", "/Library/Fonts", NSHomeDirectory() + "/Library/Fonts"]
    if let assets = try? fm.contentsOfDirectory(atPath: "/System/Library/AssetsV2") {
        for a in assets where a.hasPrefix("com_apple_MobileAsset_Font") {
            let base = "/System/Library/AssetsV2/" + a
            for s in (try? fm.contentsOfDirectory(atPath: base)) ?? [] where s.hasSuffix(".asset") { dirs.append(base + "/" + s + "/AssetData") }
        }
    }
    for d in dirs where fm.fileExists(atPath: d + "/" + file) { return URL(fileURLWithPath: d + "/" + file) }
    return nil
}

func face(_ file: String, _ name: String) -> CTFontDescriptor? {
    guard let url = findFont(file), let descs = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor] else { return nil }
    return descs.first(where: { (CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) as? String) == name }) ?? descs.first
}

guard let xingkai = face("Xingkai.ttc", "STXingkaiSC-Bold") else { print("找不到行楷（Xingkai.ttc），请先在「字体册」里下载"); exit(1) }
let songti = face("Songti.ttc", "STSongti-SC-Black")

let S: CGFloat = 1024
let rgb = CGColorSpaceCreateDeviceRGB()
func color(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat(hex >> 16 & 255) / 255, green: CGFloat(hex >> 8 & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: a)
}

struct Style { let top: UInt32; let bottom: UInt32; let ink: UInt32; let seal: Bool; let edge: CGFloat }
let styles: [String: Style] = [
    "paper": Style(top: 0xf6f3ee, bottom: 0xe6e1d9, ink: 0x1f1c19, seal: false, edge: 0.06),
    "seal":  Style(top: 0xf6f3ee, bottom: 0xe6e1d9, ink: 0x1f1c19, seal: true, edge: 0.06),
    "ink":   Style(top: 0x2a2724, bottom: 0x141312, ink: 0xece6da, seal: true, edge: 0.10),
]

/** 红色「棋」印章：中心 (cx, cy)，边长 a */
func drawSeal(_ ctx: CGContext, _ cx: CGFloat, _ cy: CGFloat, _ a: CGFloat) {
    let r = CGRect(x: cx - a / 2, y: cy - a / 2, width: a, height: a)
    ctx.addPath(CGPath(roundedRect: r, cornerWidth: a * 0.16, cornerHeight: a * 0.16, transform: nil))
    ctx.setFillColor(color(0xb03428, 0.94)); ctx.fillPath()
    if let sd = songti { drawGlyph(ctx, sd, "棋", r.midX, r.midY, a * 0.66, color(0xfaeee4)) }
}

/** 把一个字按字形实际轮廓画在 (cx, cy)，高 h */
func drawGlyph(_ ctx: CGContext, _ desc: CTFontDescriptor, _ ch: String, _ cx: CGFloat, _ cy: CGFloat, _ h: CGFloat, _ c: CGColor) {
    let font = CTFontCreateWithFontDescriptor(desc, 600, nil)
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: ch, attributes: [.font: font, .foregroundColor: NSColor(cgColor: c)!]))
    let b = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
    let k = h / b.height
    ctx.saveGState()
    ctx.translateBy(x: cx, y: cy)
    ctx.scaleBy(x: k, y: k)
    ctx.translateBy(x: -b.midX, y: -b.midY)
    ctx.textPosition = .zero
    CTLineDraw(line, ctx)
    ctx.restoreGState()
}

func render(_ st: Style, size: Int) -> CGImage {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                        space: rgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.scaleBy(x: CGFloat(size) / S, y: CGFloat(size) / S)
    ctx.setShouldAntialias(true)

    // 圆角方块（macOS 图标栅格：四周留 100，圆角 185），很淡的投影
    let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
    let shape = CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -6), blur: 18, color: color(0x000000, 0.22))
    ctx.addPath(shape); ctx.setFillColor(color(st.bottom)); ctx.fillPath()
    ctx.restoreGState()

    // 底色：自上而下极轻的过渡，没有纹理
    ctx.saveGState()
    ctx.addPath(shape); ctx.clip()
    let bg = CGGradient(colorsSpace: rgb, colors: [color(st.top), color(st.bottom)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(bg, start: CGPoint(x: 0, y: 924), end: CGPoint(x: 0, y: 100), options: [])
    ctx.restoreGState()
    // 一圈细细的内描边，让边缘在任何桌面上都清楚
    ctx.addPath(CGPath(roundedRect: tile.insetBy(dx: 1.5, dy: 1.5), cornerWidth: 183.5, cornerHeight: 183.5, transform: nil))
    ctx.setStrokeColor(color(st.ink, st.edge)); ctx.setLineWidth(3); ctx.strokePath()

    // 行楷「弈」：居中，四周留足空白
    drawGlyph(ctx, xingkai, "弈", S / 2 - (st.seal ? 14 : 0), S / 2 + (st.seal ? 10 : 0), 470, color(st.ink))

    // 红色「棋」印章：右下角的一方小印，与开始菜单一致
    if st.seal { drawSeal(ctx, 678, 300, 76) }
    return ctx.makeImage()!
}

/** 一颗棋子：黑子墨色带一点高光，白子米白带一圈淡边 */
func drawStone(_ ctx: CGContext, _ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat, black: Bool) {
    let rect = CGRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -r * 0.12), blur: r * 0.3, color: color(0x000000, 0.25))
    ctx.addEllipse(in: rect); ctx.setFillColor(color(black ? 0x1f1c19 : 0xf7f3ea)); ctx.fillPath()
    ctx.restoreGState()
    ctx.saveGState()
    ctx.addEllipse(in: rect); ctx.clip()
    let hi = CGGradient(colorsSpace: rgb, colors: (black ? [color(0x6a645c, 0.9), color(0x1f1c19, 0)] : [color(0xffffff, 1), color(0xd9d2c4, 0.6)]) as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(hi, startCenter: CGPoint(x: cx - r * 0.35, y: cy + r * 0.4), startRadius: 0,
                           endCenter: CGPoint(x: cx, y: cy), endRadius: r * 1.1, options: [])
    ctx.restoreGState()
    if !black { ctx.addEllipse(in: rect.insetBy(dx: 0.5, dy: 0.5)); ctx.setStrokeColor(color(0x1f1c19, 0.18)); ctx.setLineWidth(1); ctx.strokePath() }
}

/** 不透明的画布（安装程序的图不能带透明） */
func canvas(_ w: Int, _ h: Int, _ draw: (CGContext) -> Void) -> CGImage {
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                        space: rgb, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.setShouldAntialias(true)
    draw(ctx)
    return ctx.makeImage()!
}

/** 欢迎页、完成页左边的竖条：标准是 164×314，按两倍画，高分屏上也清楚（安装程序会缩放到实际大小） */
func sidebar() -> CGImage {
    let W: CGFloat = 328, H: CGFloat = 628
    return canvas(Int(W), Int(H)) { ctx in
        let bg = CGGradient(colorsSpace: rgb, colors: [color(0xf6f3ee), color(0xe9e1d2)] as CFArray, locations: [0, 1])!
        ctx.drawLinearGradient(bg, start: CGPoint(x: 0, y: H), end: CGPoint(x: 0, y: 0), options: [])
        // 下半部分一角棋盘，越往上越淡
        let step: CGFloat = 38, x0: CGFloat = 50, y0: CGFloat = 40
        ctx.setLineWidth(1.5)
        for i in 0..<8 {
            let y = y0 + CGFloat(i) * step
            ctx.setStrokeColor(color(0x1f1c19, 0.16 * (1 - CGFloat(i) / 8)))
            ctx.move(to: CGPoint(x: x0, y: y)); ctx.addLine(to: CGPoint(x: W, y: y)); ctx.strokePath()
        }
        for j in 0..<8 {
            let x = x0 + CGFloat(j) * step
            let g = CGGradient(colorsSpace: rgb, colors: [color(0x1f1c19, 0.16), color(0x1f1c19, 0)] as CFArray, locations: [0, 1])!
            ctx.saveGState()
            ctx.clip(to: CGRect(x: x - 0.75, y: 0, width: 1.5, height: y0 + 7 * step))
            ctx.drawLinearGradient(g, start: CGPoint(x: 0, y: y0), end: CGPoint(x: 0, y: y0 + 7 * step), options: [])
            ctx.restoreGState()
        }
        // 几颗子
        for (i, j, b) in [(2, 1, true), (3, 2, false), (3, 1, true), (4, 2, true), (5, 1, false), (2, 3, false)] {
            drawStone(ctx, x0 + CGFloat(i) * step, y0 + CGFloat(j) * step, step * 0.46, black: b)
        }
        drawGlyph(ctx, xingkai, "弈", W / 2 - 6, H * 0.66, 200, color(0x1f1c19))
        drawSeal(ctx, W / 2 + 92, H * 0.66 - 104, 40)
    }
}

/** 其他页面右上角的小图：标准是 150×57，同样按两倍画；底色与安装程序标题栏一样是白色 */
func header() -> CGImage {
    let W: CGFloat = 300, H: CGFloat = 114
    return canvas(Int(W), Int(H)) { ctx in
        ctx.setFillColor(color(0xffffff)); ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
        drawGlyph(ctx, xingkai, "弈", W - 92, H / 2 + 4, 76, color(0x1f1c19))
        drawSeal(ctx, W - 44, H / 2 - 30, 20)
    }
}

/** 写成 24 位 BMP（安装程序只认这种） */
func saveBMP(_ img: CGImage, _ path: String) {
    let w = img.width, h = img.height, row = (w * 3 + 3) & ~3
    var px = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: rgb, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    var d = Data()
    func u16(_ v: Int) { d.append(contentsOf: [UInt8(v & 255), UInt8(v >> 8 & 255)]) }
    func u32(_ v: Int) { u16(v & 0xffff); u16(v >> 16) }
    d.append(contentsOf: [0x42, 0x4d]); u32(54 + row * h); u32(0); u32(54)
    u32(40); u32(w); u32(h); u16(1); u16(24); u32(0); u32(row * h); u32(2835); u32(2835); u32(0); u32(0)
    for y in (0..<h).reversed() {                         // BMP 从最下面一行开始存
        var line = [UInt8](repeating: 0, count: row)
        for x in 0..<w { let i = (y * w + x) * 4; line[x * 3] = px[i + 2]; line[x * 3 + 1] = px[i + 1]; line[x * 3 + 2] = px[i] }
        d.append(contentsOf: line)
    }
    try! d.write(to: URL(fileURLWithPath: path))
    print("已生成 \(path)（\(w)×\(h)）")
}

func save(_ img: CGImage, _ path: String) {
    let out = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
    try! NSBitmapImageRep(cgImage: img).representation(using: .png, properties: [:])!.write(to: out)
    print("已生成 \(path)（\(img.width)×\(img.height)）")
}

let args = CommandLine.arguments
let name = args.count > 1 ? args[1] : "seal"
guard let st = styles[name] else { print("没有这个方案：\(name)（可选 paper、seal、ink）"); exit(1) }
if args.count > 2 { save(render(st, size: 1024), args[2]); exit(0) }
save(render(st, size: 1024), "build-res/icon.png")
save(render(st, size: 256), "public/icon.png")
saveBMP(sidebar(), "build-res/installerSidebar.bmp")
saveBMP(header(), "build-res/installerHeader.bmp")
