---
title: Animated GIF timing and limits
description: Frame timing, clip context, and decoder limits for GIF image input.
sidebar:
  label: Animated GIF limits
---
Animated GIF supports GIF87a and GIF89a image assets, including transparency and interlacing.

## Timing

The decoded animation loops, including for negative media time. A clip's media time selects the frame.

GIF delays use hundredths of a second. A stored delay of 0 or 1 becomes 0.10 seconds. A delay of 2 or more retains its encoded value, so a delay of 2 is 0.02 seconds.

## Decoder limits

| Limit | Value | Result |
| --- | --- | --- |
| Frames | 512 | Decoding stops at the frame cap. |
| Canvas area | 67,108,864 pixels | A larger GIF canvas fails decoding. |
| Accumulated frame area | 67,108,864 pixels | Each full-canvas frame consumes the budget. Decoding stops once the remaining budget is zero or less. |

Each decoded frame consumes the budget at full canvas size.

These limits apply to input decoding. Animated GIF does not add a GIF export format.

For input steps, see [Use an animated GIF](/docs/features/gif-support/).
