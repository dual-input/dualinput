param([string]$In, [string]$Out)
# Writes a PNG as an uncompressed 32-bit DDS, one level, BGRA in memory, with
# its alpha: the plainest texture file the sim might load without its packager,
# which left our PNG out of the package (record/areas/interface/log.md, 2026-10-04).
# The header is DDS_HEADER with DDPF_RGB | DDPF_ALPHAPIXELS and A8R8G8B8 masks.
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $In
$w = $bmp.Width; $h = $bmp.Height
$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$pixels = New-Object byte[] ($w * $h * 4)
for ($y = 0; $y -lt $h; $y++) {
  [System.Runtime.InteropServices.Marshal]::Copy([IntPtr]::Add($data.Scan0, $y * $data.Stride), $pixels, $y * $w * 4, $w * 4)
}
$bmp.UnlockBits($data); $bmp.Dispose()
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([byte[]][char[]]"DDS ")
$bw.Write([uint32]124)                                   # dwSize
$bw.Write([uint32](0x1 -bor 0x2 -bor 0x4 -bor 0x8 -bor 0x1000)) # CAPS | HEIGHT | WIDTH | PITCH | PIXELFORMAT
$bw.Write([uint32]$h); $bw.Write([uint32]$w)
$bw.Write([uint32]($w * 4))                              # pitch
$bw.Write([uint32]0); $bw.Write([uint32]1)               # depth, mip count
for ($i = 0; $i -lt 11; $i++) { $bw.Write([uint32]0) }   # reserved
$bw.Write([uint32]32); $bw.Write([uint32](0x40 -bor 0x1)) # pixel format size, RGB | ALPHAPIXELS
$bw.Write([uint32]0); $bw.Write([uint32]32)              # fourCC, bit count
# The alpha mask as decimal: PowerShell reads 0xff000000 as a negative Int32.
$bw.Write([uint32]0x00ff0000); $bw.Write([uint32]0x0000ff00); $bw.Write([uint32]0x000000ff); $bw.Write([uint32]4278190080)
$bw.Write([uint32]0x1000)                                # caps: TEXTURE
for ($i = 0; $i -lt 4; $i++) { $bw.Write([uint32]0) }    # caps2, caps3, caps4, reserved2
$bw.Write($pixels)
$bw.Flush()
[System.IO.File]::WriteAllBytes($Out, $ms.ToArray())
"wrote $Out, ${w}x${h}, $($ms.Length) bytes"
