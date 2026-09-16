/*******************************************************************************
 * Size: 9 px
 * Bpp: 1
 * Opts: --bpp 1 --size 9 --no-compress --stride 1 --align 1 --font DejaVuSans.ttf --symbols ABCDEFGHIJKLKMNOPQRSTUVWYZabcdefghijklmnopqrstuvwxyz --format lvgl -o dejavu9.c
 ******************************************************************************/

#ifdef __has_include
    #if __has_include("lvgl.h")
        #ifndef LV_LVGL_H_INCLUDE_SIMPLE
            #define LV_LVGL_H_INCLUDE_SIMPLE
        #endif
    #endif
#endif

#ifdef LV_LVGL_H_INCLUDE_SIMPLE
    #include "lvgl.h"
#else
    #include "lvgl/lvgl.h"
#endif



#ifndef DEJAVU9
#define DEJAVU9 1
#endif

#if DEJAVU9

/*-----------------
 *    BITMAPS
 *----------------*/

/*Store the image of the glyphs*/
static LV_ATTRIBUTE_LARGE_CONST const uint8_t glyph_bitmap[] = {
    /* U+0041 "A" */
    0x30, 0xc5, 0x12, 0x7a, 0x18, 0x40,

    /* U+0042 "B" */
    0xf4, 0xa5, 0xc9, 0xc7, 0xc0,

    /* U+0043 "C" */
    0x7b, 0x18, 0x20, 0x83, 0x17, 0x80,

    /* U+0044 "D" */
    0xf2, 0x38, 0x61, 0x86, 0x3f, 0x80,

    /* U+0045 "E" */
    0xf8, 0x8f, 0x88, 0xf0,

    /* U+0046 "F" */
    0xf8, 0x8f, 0x88, 0x80,

    /* U+0047 "G" */
    0x7b, 0x18, 0x23, 0x87, 0x17, 0x80,

    /* U+0048 "H" */
    0x8c, 0x63, 0xf8, 0xc6, 0x20,

    /* U+0049 "I" */
    0xfe,

    /* U+004A "J" */
    0x55, 0x55, 0x80,

    /* U+004B "K" */
    0x9d, 0xb9, 0x8a, 0x4a, 0x20,

    /* U+004C "L" */
    0x88, 0x88, 0x88, 0xf0,

    /* U+004D "M" */
    0xcf, 0x3d, 0x6d, 0xb6, 0x18, 0x40,

    /* U+004E "N" */
    0xce, 0x73, 0x5a, 0xce, 0x60,

    /* U+004F "O" */
    0x7b, 0x38, 0x61, 0x87, 0x37, 0x80,

    /* U+0050 "P" */
    0xe9, 0x99, 0xe8, 0x80,

    /* U+0051 "Q" */
    0x7b, 0x38, 0x61, 0x87, 0x37, 0x82,

    /* U+0052 "R" */
    0xe4, 0xa5, 0xc9, 0x4a, 0x20,

    /* U+0053 "S" */
    0x7c, 0x20, 0xe0, 0x87, 0xc0,

    /* U+0054 "T" */
    0xf9, 0x8, 0x42, 0x10, 0x80,

    /* U+0055 "U" */
    0x8c, 0x63, 0x18, 0xc5, 0xc0,

    /* U+0056 "V" */
    0x85, 0x14, 0x92, 0x30, 0xc3, 0x0,

    /* U+0057 "W" */
    0x89, 0x2c, 0x95, 0x4a, 0xa5, 0x53, 0x30, 0x88,

    /* U+0059 "Y" */
    0x8a, 0x94, 0x42, 0x10, 0x80,

    /* U+005A "Z" */
    0xfc, 0x21, 0x8, 0x43, 0xf, 0xc0,

    /* U+0061 "a" */
    0xe1, 0xf9, 0xf0,

    /* U+0062 "b" */
    0x88, 0xe9, 0x99, 0xe0,

    /* U+0063 "c" */
    0x78, 0x88, 0x70,

    /* U+0064 "d" */
    0x11, 0x79, 0x99, 0x70,

    /* U+0065 "e" */
    0x74, 0x7f, 0x7, 0x80,

    /* U+0066 "f" */
    0x74, 0xe4, 0x44, 0x40,

    /* U+0067 "g" */
    0x79, 0x99, 0x71, 0x60,

    /* U+0068 "h" */
    0x88, 0xf9, 0x99, 0x90,

    /* U+0069 "i" */
    0xbe,

    /* U+006A "j" */
    0x45, 0x55, 0xc0,

    /* U+006B "k" */
    0x84, 0x25, 0x4c, 0x52, 0x40,

    /* U+006C "l" */
    0xfe,

    /* U+006D "m" */
    0xff, 0x26, 0x4c, 0x99, 0x20,

    /* U+006E "n" */
    0xf9, 0x99, 0x90,

    /* U+006F "o" */
    0x74, 0x63, 0x17, 0x0,

    /* U+0070 "p" */
    0xe9, 0x99, 0xe8, 0x80,

    /* U+0071 "q" */
    0x79, 0x99, 0x71, 0x10,

    /* U+0072 "r" */
    0xf2, 0x48,

    /* U+0073 "s" */
    0xf8, 0x61, 0xf0,

    /* U+0074 "t" */
    0x44, 0xf4, 0x44, 0x70,

    /* U+0075 "u" */
    0x99, 0x99, 0xf0,

    /* U+0076 "v" */
    0x8a, 0x54, 0xa2, 0x0,

    /* U+0077 "w" */
    0x92, 0xb5, 0xb3, 0x62, 0x40,

    /* U+0078 "x" */
    0x4a, 0x88, 0xa4, 0x80,

    /* U+0079 "y" */
    0x8a, 0x94, 0x62, 0x11, 0x0,

    /* U+007A "z" */
    0xf1, 0x68, 0xf0
};


/*---------------------
 *  GLYPH DESCRIPTION
 *--------------------*/

static const lv_font_fmt_txt_glyph_dsc_t glyph_dsc[] = {
    {.bitmap_index = 0, .adv_w = 0, .box_w = 0, .box_h = 0, .ofs_x = 0, .ofs_y = 0} /* id = 0 reserved */,
    {.bitmap_index = 0, .adv_w = 99, .box_w = 6, .box_h = 7, .ofs_x = 0, .ofs_y = 0},
    {.bitmap_index = 6, .adv_w = 99, .box_w = 5, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 11, .adv_w = 101, .box_w = 6, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 17, .adv_w = 111, .box_w = 6, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 23, .adv_w = 91, .box_w = 4, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 27, .adv_w = 83, .box_w = 4, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 31, .adv_w = 112, .box_w = 6, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 37, .adv_w = 108, .box_w = 5, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 42, .adv_w = 42, .box_w = 1, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 43, .adv_w = 42, .box_w = 2, .box_h = 9, .ofs_x = 0, .ofs_y = -2},
    {.bitmap_index = 46, .adv_w = 94, .box_w = 5, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 51, .adv_w = 80, .box_w = 4, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 55, .adv_w = 124, .box_w = 6, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 61, .adv_w = 108, .box_w = 5, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 66, .adv_w = 113, .box_w = 6, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 72, .adv_w = 87, .box_w = 4, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 76, .adv_w = 113, .box_w = 6, .box_h = 8, .ofs_x = 1, .ofs_y = -1},
    {.bitmap_index = 82, .adv_w = 100, .box_w = 5, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 87, .adv_w = 91, .box_w = 5, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 92, .adv_w = 88, .box_w = 5, .box_h = 7, .ofs_x = 0, .ofs_y = 0},
    {.bitmap_index = 97, .adv_w = 105, .box_w = 5, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 102, .adv_w = 99, .box_w = 6, .box_h = 7, .ofs_x = 0, .ofs_y = 0},
    {.bitmap_index = 108, .adv_w = 142, .box_w = 9, .box_h = 7, .ofs_x = 0, .ofs_y = 0},
    {.bitmap_index = 116, .adv_w = 88, .box_w = 5, .box_h = 7, .ofs_x = 0, .ofs_y = 0},
    {.bitmap_index = 121, .adv_w = 99, .box_w = 6, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 127, .adv_w = 88, .box_w = 4, .box_h = 5, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 130, .adv_w = 91, .box_w = 4, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 134, .adv_w = 79, .box_w = 4, .box_h = 5, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 137, .adv_w = 91, .box_w = 4, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 141, .adv_w = 89, .box_w = 5, .box_h = 5, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 145, .adv_w = 51, .box_w = 4, .box_h = 7, .ofs_x = 0, .ofs_y = 0},
    {.bitmap_index = 149, .adv_w = 91, .box_w = 4, .box_h = 7, .ofs_x = 1, .ofs_y = -2},
    {.bitmap_index = 153, .adv_w = 91, .box_w = 4, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 157, .adv_w = 40, .box_w = 1, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 158, .adv_w = 40, .box_w = 2, .box_h = 9, .ofs_x = 0, .ofs_y = -2},
    {.bitmap_index = 161, .adv_w = 83, .box_w = 5, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 166, .adv_w = 40, .box_w = 1, .box_h = 7, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 167, .adv_w = 140, .box_w = 7, .box_h = 5, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 172, .adv_w = 91, .box_w = 4, .box_h = 5, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 175, .adv_w = 88, .box_w = 5, .box_h = 5, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 179, .adv_w = 91, .box_w = 4, .box_h = 7, .ofs_x = 1, .ofs_y = -2},
    {.bitmap_index = 183, .adv_w = 91, .box_w = 4, .box_h = 7, .ofs_x = 1, .ofs_y = -2},
    {.bitmap_index = 187, .adv_w = 59, .box_w = 3, .box_h = 5, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 189, .adv_w = 75, .box_w = 4, .box_h = 5, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 192, .adv_w = 56, .box_w = 4, .box_h = 7, .ofs_x = 0, .ofs_y = 0},
    {.bitmap_index = 196, .adv_w = 91, .box_w = 4, .box_h = 5, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 199, .adv_w = 85, .box_w = 5, .box_h = 5, .ofs_x = 0, .ofs_y = 0},
    {.bitmap_index = 203, .adv_w = 118, .box_w = 7, .box_h = 5, .ofs_x = 0, .ofs_y = 0},
    {.bitmap_index = 208, .adv_w = 85, .box_w = 5, .box_h = 5, .ofs_x = 0, .ofs_y = 0},
    {.bitmap_index = 212, .adv_w = 85, .box_w = 5, .box_h = 7, .ofs_x = 0, .ofs_y = -2},
    {.bitmap_index = 217, .adv_w = 76, .box_w = 4, .box_h = 5, .ofs_x = 1, .ofs_y = 0}
};

/*---------------------
 *  CHARACTER MAPPING
 *--------------------*/



/*Collect the unicode lists and glyph_id offsets*/
static const lv_font_fmt_txt_cmap_t cmaps[] =
{
    {
        .range_start = 65, .range_length = 23, .glyph_id_start = 1,
        .unicode_list = NULL, .glyph_id_ofs_list = NULL, .list_length = 0, .type = LV_FONT_FMT_TXT_CMAP_FORMAT0_TINY
    },
    {
        .range_start = 89, .range_length = 2, .glyph_id_start = 24,
        .unicode_list = NULL, .glyph_id_ofs_list = NULL, .list_length = 0, .type = LV_FONT_FMT_TXT_CMAP_FORMAT0_TINY
    },
    {
        .range_start = 97, .range_length = 26, .glyph_id_start = 26,
        .unicode_list = NULL, .glyph_id_ofs_list = NULL, .list_length = 0, .type = LV_FONT_FMT_TXT_CMAP_FORMAT0_TINY
    }
};



/*--------------------
 *  ALL CUSTOM DATA
 *--------------------*/

#if LVGL_VERSION_MAJOR == 8
/*Store all the custom data of the font*/
static  lv_font_fmt_txt_glyph_cache_t cache;
#endif

#if LVGL_VERSION_MAJOR >= 8
static const lv_font_fmt_txt_dsc_t font_dsc = {
#else
static lv_font_fmt_txt_dsc_t font_dsc = {
#endif
    .glyph_bitmap = glyph_bitmap,
    .glyph_dsc = glyph_dsc,
    .cmaps = cmaps,
    .kern_dsc = NULL,
    .kern_scale = 0,
    .cmap_num = 3,
    .bpp = 1,
    .kern_classes = 0,
    .bitmap_format = 0,
#if LVGL_VERSION_MAJOR == 8
    .cache = &cache
#endif

};



/*-----------------
 *  PUBLIC FONT
 *----------------*/

/*Initialize a public general font descriptor*/
#if LVGL_VERSION_MAJOR >= 8
const lv_font_t dejavu9 = {
#else
lv_font_t dejavu9 = {
#endif
    .get_glyph_dsc = lv_font_get_glyph_dsc_fmt_txt,    /*Function pointer to get glyph's data*/
    .get_glyph_bitmap = lv_font_get_bitmap_fmt_txt,    /*Function pointer to get glyph's bitmap*/
    .line_height = 9,          /*The maximum line height required by the font*/
    .base_line = 2,             /*Baseline measured from the bottom of the line*/
#if !(LVGL_VERSION_MAJOR == 6 && LVGL_VERSION_MINOR == 0)
    .subpx = LV_FONT_SUBPX_NONE,
#endif
#if LV_VERSION_CHECK(7, 4, 0) || LVGL_VERSION_MAJOR >= 8
    .underline_position = -1,
    .underline_thickness = 0,
#endif
    .static_bitmap = 0,
    .dsc = &font_dsc,          /*The custom font data. Will be accessed by `get_glyph_bitmap/dsc` */
#if LV_VERSION_CHECK(8, 2, 0) || LVGL_VERSION_MAJOR >= 9
    .fallback = NULL,
#endif
    .user_data = NULL,
};



#endif /*#if DEJAVU9*/
