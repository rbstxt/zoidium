---
title: Native FX generators
description: Exact Native FX controls, defaults, output, and limits.
sidebar:
  label: Native FX generators
  order: 74
---
[Native FX overview](/docs/reference/native-fx/) lists every effect.

## Time and coordinates

These effects generate graphics over the current input. They do not capture earlier or later frames.
Point coordinates use 0 to 1 across the image, with X increasing rightward and Y increasing downward.
Point properties without explicit numeric bounds can also place graphics outside the image.
For time-based generators, seconds equal the evaluated effect frame divided by the project frame rate.
Clip placement limits when the output is visible. A — range means no declared minimum or maximum.

## Radio Waves

Draws expanding polygon or circle waves from a producer point.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Producer Point** | Vector2 | See component rows | `(0.5, 0.5)` | Wave origin in normalized image coordinates. |
| **Producer Point.X** | Number | — | 0.5 | Horizontal component of Producer Point. |
| **Producer Point.Y** | Number | — | 0.5 | Vertical component of Producer Point. |
| **Frequency (waves/sec)** | Number | 0.01 to 100 | 1 | Emission frequency in waves per second. |
| **Expansion (px/sec)** | Number | 0 to 10000 | 100 | Radius growth in layer pixels per second. |
| **Orientation** | Number | -3600 to 3600 | 0 | Initial wave rotation in degrees. |
| **Direction** | Number | -3600 to 3600 | 90 | Drift direction in degrees. 0 moves upward, and 90 moves right. |
| **Velocity (px/sec)** | Number | 0 to 10000 | 0 | Wave-center drift speed in layer pixels per second. |
| **Spin (deg/sec)** | Number | -3600 to 3600 | 0 | Rotation speed in degrees per second of wave age. |
| **Lifespan (sec)** | Number | 0.01 to 100 | 2 | Duration of each wave in seconds. |
| **Reflection** | Option | **off**, **on** | **off** | Reflects drifting centers at the image boundaries. |
| **Wave Type** | Option | **Polygon**, **Circle** | **Polygon** | Polygon uses Sides and Star. Circle forces a circle and ignores Star. |
| **Sides** | Number | 3 to 64 | 64 | Polygon side count. 64 with Star off produces a circle. |
| **Star** | Option | **off**, **on** | **off** | Alternates polygon radii for a star in Polygon mode. |
| **Star Depth (inner radius)** | Number | -1 to 1 | -0.3 | Star's alternate radius multiplier. Zero produces equal radii. |
| **Stroke Profile** | Option | **Square**, **Taper Front**, **Taper Back**, **Taper Both**, **Sine**, **Sawtooth Out**, **Sawtooth In** | **Square** | Stroke intensity profile across the wave width. |
| **Stroke Color** | Color | — | `[1, 1, 1]` | Wave stroke color. |
| **Opacity** | Number | 0 to 100 | 100 | Wave opacity as a percentage, before fades. |
| **Fade-in Time (sec)** | Number | 0 to 100 | 0 | Linear opacity rise after each wave's birth. Zero disables this fade. |
| **Fade-out Time (sec)** | Number | 0 to 100 | 0 | Linear opacity fall before each wave's lifespan ends. Zero disables this fade. |
| **Start Width (px)** | Number | 0 to 1000 | 5 | Stroke width at birth, in layer pixels. |
| **End Width (px)** | Number | 0 to 1000 | 5 | Stroke width at the end of the lifespan, interpolated from Start Width. |
| **Composite on Original** | Option | **off**, **on** | **on** | on composites waves over the original input. off outputs waves on transparency. |

### Temporal behavior and limits

Every wave uses the current frame's property values, including waves born earlier.
Negative time clamps to zero.

Only the newest 24 waves are considered; at high frequencies, still-living older waves can drop out.
**Circle**, or **Polygon** with 64 sides and **Star** off, uses the circular outline.
There are no image-contour or mask wave sources.
Stroke width has a minimum of 0.5 layer pixels.

## Beam

Draws a colored beam along a segment between two points.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Starting Point** | Vector2 | See component rows | `(0.25, 0.5)` | Segment start in normalized image coordinates. |
| **Starting Point.X** | Number | — | 0.25 | Horizontal component of Starting Point. |
| **Starting Point.Y** | Number | — | 0.5 | Vertical component of Starting Point. |
| **Ending Point** | Vector2 | See component rows | `(0.75, 0.5)` | Segment end in normalized image coordinates. |
| **Ending Point.X** | Number | — | 0.75 | Horizontal component of Ending Point. |
| **Ending Point.Y** | Number | — | 0.5 | Vertical component of Ending Point. |
| **Length (%)** | Number | 0 to 100 | 25 | Visible fraction of the complete segment, as a percentage. |
| **Time (%)** | Number | 0 to 100 | 0 | Position of the visible window along the segment, as a percentage. |
| **Starting Thickness (px)** | Number | 0 to 1000 | 8 | Thickness at the starting end in layer pixels. |
| **Ending Thickness (px)** | Number | 0 to 1000 | 8 | Thickness at the ending end in layer pixels. |
| **Softness (%)** | Number | 0 to 100 | 20 | Width of the alpha fade at the beam edge, as a percentage of its half-width. The color gradient is independent of this control. |
| **Inside Color** | Color | — | `[1, 1, 1]` | Beam core color. |
| **Outside Color** | Color | — | `[0.4, 0.4, 1]` | Beam edge color. |
| **3D Perspective** | Option | **off**, **on** | **on** | on interpolates thickness along the full segment. off interpolates thickness across the visible window. |
| **Composite on Original** | Option | **off**, **on** | **on** | on composites the beam over the original input. off outputs the beam on transparency. |

### Window and limits

**Time (%)** is an explicit property, not an automatic clock. The beam moves only when its properties change.
**3D Perspective** changes thickness interpolation, not the scene camera or depth.
Zero **Length (%)** hides the beam.

## Numbers

Draws a number, formatted time, date, or hexadecimal value.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Type** | Option | **Number**, **Number (Leading Zeros)**, **Timecode (30)**, **Timecode (25)**, **Timecode (24)**, **Time**, **Numerical Date**, **Short Date**, **Long Date**, **Hexadecimal** | **Number** | Selects the numeric, time, date, or hexadecimal format. Leading zeros pads the integer part to at least five digits. |
| **Random Values** | Option | **off**, **on** | **off** | Replaces the value with a repeatable frame-and-seed random value scaled by Value/Offset/Random Max. |
| **Seed** | Number | 0 to 100000 | 1 | Seed for Random Values. |
| **Value/Offset/Random Max** | Number | -30000 to 30000 | 0 | Base value, time offset in seconds, date offset in days, or signed random multiplier, depending on Type. |
| **Decimal Places** | Number | 0 to 10 | 2 | Decimal precision for Number and Number (Leading Zeros). |
| **Current Time/Date** | Option | **off**, **on** | **off** | Adds the evaluated frame time for Number, Timecode, and Time formats. Other formats ignore it. |
| **Position** | Vector2 | See component rows | `(0.5, 0.5)` | Text center in normalized image coordinates. |
| **Position.X** | Number | — | 0.5 | Horizontal component of Position. |
| **Position.Y** | Number | — | 0.5 | Vertical component of Position. |
| **Display Options** | Option | **Fill Only**, **Stroke Only**, **Fill Over Stroke**, **Stroke Over Fill** | **Fill Only** | Selects fill, stroke, or their overlap order. |
| **Fill Color** | Color | — | `[1, 0, 0]` | Glyph fill color. |
| **Stroke Color** | Color | — | `[1, 1, 1]` | Glyph outline color. |
| **Stroke Width (px)** | Number | 0 to 50 | 2 | Glyph outline width in pixels. |
| **Size (px)** | Number | 0 to 512 | 36 | Text size in pixels. Rendering clamps the effective size to at least 0.5. |
| **Tracking (px)** | Number | -100 to 100 | 0 | Additional spacing between characters in pixels. |
| **Proportional Spacing** | Option | **off**, **on** | **on** | on uses glyph-dependent advances. off uses a fixed character advance. |
| **Composite on Original** | Option | **off**, **on** | **on** | on composites text over the original input. off outputs text on transparency. |

### Time, date, and limits

The same frame and seed produce the same value.
**Current Time/Date** uses evaluated effect time, not the system clock.
It affects **Number**, the three **Timecode** formats, and **Time**. **Number (Leading Zeros)**, date formats, and **Hexadecimal** ignore that switch.
Dates interpret the integer part of the value as days relative to 1970-01-01. Date and month names are fixed English strings.
**Hexadecimal** rounds to an integer and uses uppercase digits.

Glyphs use a built-in font. There is no font-selection property.

## Timecode

Draws the evaluated time as SMPTE timecode, frames, or feet and frames.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Display Format** | Option | **SMPTE HH:MM:SS:FF**, **Frames**, **Feet + Frames (35mm)**, **Feet + Frames (16mm)** | **SMPTE HH:MM:SS:FF** | SMPTE timecode, total frames, or feet and frames. 35mm uses 16 frames per foot. 16mm uses 40. |
| **Time Source** | Option | **Layer Source**, **Composition**, **Custom** | **Layer Source** | Layer Source and Composition use the same clock. Custom uses Time Units (fps) and Starting Frame. |
| **Time Units (fps)** | Number | 1 to 120 | 30 | Display rate used only by Custom. |
| **Drop Frame** | Option | **off**, **on** | **off** | Applies drop-frame numbering only to SMPTE output at a rounded nominal rate of 30 or 60. It does not remove image frames. |
| **Starting Frame** | Number | -1000000 to 1000000 | 0 | Frame-number offset used only by Custom. |
| **Text Position** | Vector2 | See component rows | `(0.5, 0.9)` | Text center in normalized image coordinates. |
| **Text Position.X** | Number | — | 0.5 | Horizontal component of Text Position. |
| **Text Position.Y** | Number | — | 0.9 | Vertical component of Text Position. |
| **Text Size (px)** | Number | 0 to 512 | 36 | Text size in pixels. Rendering clamps the effective size to at least 0.5. |
| **Text Color** | Color | — | `[1, 1, 1]` | Glyph color. |
| **Show Box** | Option | **off**, **on** | **on** | on draws a rectangular background behind the text. |
| **Box Color** | Color | — | `[0, 0, 0]` | Background-box color. |
| **Opacity** | Number | 0 to 100 | 100 | Text and box opacity as a percentage. Text texture opacity refreshes only when text or layout changes. |
| **Composite on Original** | Option | **off**, **on** | **on** | on composites the display over the original input. off outputs the display on transparency. |

### Clock and limits

**Layer Source** does not read embedded source-media timecode. **Composition** currently uses the same clock.
The effect does not sample another frame. Clip boundaries control visibility.

Glyphs use the same built-in font as **Numbers**. There is no font-selection property.
An **Opacity** change alone updates the box; the text opacity refreshes only when the string, size, position, or resolution changes.
