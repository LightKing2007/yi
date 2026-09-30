// 应用图标：极简的圆角方块，正中一个行楷「弈」（与开始菜单、宣传片片名同一款字），配色取自游戏界面。
//   swift scripts/make-icon.swift [方案]      方案：paper（默认，暖白底墨字）、seal（暖白底墨字 + 红印）、ink（墨底米白字）
// 输出 build-res/icon.png（1024×1024，打包时自动转换成各平台格式）与 public/icon.png（256×256，窗口图标）。
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
    if st.seal {
        let r = CGRect(x: 640, y: 262, width: 76, height: 76)
        ctx.addPath(CGPath(roundedRect: r, cornerWidth: 12, cornerHeight: 12, transform: nil))
        ctx.setFillColor(color(0xb03428, 0.94)); ctx.fillPath()
        if let sd = songti { drawGlyph(ctx, sd, "棋", r.midX, r.midY, 50, color(0xfaeee4)) }
    }
    return ctx.makeImage()!
}

func save(_ img: CGImage, _ path: String) {
    let out = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
    try! NSBitmapImageRep(cgImage: img).representation(using: .png, properties: [:])!.write(to: out)
    print("已生成 \(path)（\(img.width)×\(img.height)）")
}

let args = CommandLine.arguments
let name = args.count > 1 ? args[1] : "paper"
guard let st = styles[name] else { print("没有这个方案：\(name)（可选 paper、seal、ink）"); exit(1) }
if args.count > 2 { save(render(st, size: 1024), args[2]); exit(0) }
save(render(st, size: 1024), "build-res/icon.png")
save(render(st, size: 256), "public/icon.png")
