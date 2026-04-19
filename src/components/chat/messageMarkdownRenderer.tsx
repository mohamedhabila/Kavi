import React, { type ReactNode, useMemo } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { Renderer, type RendererInterface } from 'react-native-marked';
import { type AppPalette } from '../../theme/useAppTheme';

const TABLE_HORIZONTAL_PADDING = 24;
const MIN_TABLE_WIDTH = 160;
const MIN_TABLE_CELL_WIDTH = 132;
const MAX_TABLE_CELL_WIDTH = 220;
const ASSISTANT_BUBBLE_WIDTH_RATIO = 0.96;
const USER_BUBBLE_WIDTH_RATIO = 0.88;

interface MessageMarkdownTableProps {
  header: ReactNode[][];
  rows: ReactNode[][][];
  tableStyle?: ViewStyle;
  rowStyle?: ViewStyle;
  cellStyle?: ViewStyle;
  colors: AppPalette;
  isUser: boolean;
}

export function getMessageMarkdownTableColumnWidths(
  totalCols: number,
  availableWidth: number,
): number[] {
  if (totalCols < 1) {
    return [];
  }

  const boundedWidth = Math.max(MIN_TABLE_WIDTH, availableWidth);
  const targetWidth = Math.floor(boundedWidth / Math.min(totalCols, 3));
  const cellWidth = Math.max(MIN_TABLE_CELL_WIDTH, Math.min(MAX_TABLE_CELL_WIDTH, targetWidth));

  return Array.from({ length: totalCols }, () => cellWidth);
}

function getApproximateBubbleWidth(windowWidth: number, isUser: boolean): number {
  const widthRatio = isUser ? USER_BUBBLE_WIDTH_RATIO : ASSISTANT_BUBBLE_WIDTH_RATIO;
  return Math.max(MIN_TABLE_WIDTH, Math.floor(windowWidth * widthRatio) - TABLE_HORIZONTAL_PADDING);
}

export const MessageMarkdownTable: React.FC<MessageMarkdownTableProps> = ({
  header,
  rows,
  tableStyle,
  rowStyle,
  cellStyle,
  colors,
  isUser,
}) => {
  const { width: windowWidth } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors, isUser), [colors, isUser]);

  const bubbleWidth = useMemo(
    () => getApproximateBubbleWidth(windowWidth, isUser),
    [windowWidth, isUser],
  );
  const columnCount = Math.max(header.length, rows[0]?.length ?? 0);
  const widthArr = useMemo(
    () => getMessageMarkdownTableColumnWidths(columnCount, bubbleWidth),
    [columnCount, bubbleWidth],
  );

  if (columnCount < 1) {
    return null;
  }

  const flattenedTableStyle = StyleSheet.flatten(tableStyle) ?? {};
  const borderWidth =
    typeof flattenedTableStyle.borderWidth === 'number'
      ? flattenedTableStyle.borderWidth
      : StyleSheet.hairlineWidth;
  const borderColor =
    typeof flattenedTableStyle.borderColor === 'string'
      ? flattenedTableStyle.borderColor
      : colors.subtleBorder;
  const tableWidth = widthArr.reduce((sum, value) => sum + value, 0);
  const tableSurfaceStyle = {
    width: tableWidth,
    minWidth: tableWidth,
    borderLeftWidth: borderWidth,
    borderBottomWidth: borderWidth,
    borderColor,
  } as const;

  return (
    <View style={styles.frame} testID="message-markdown-table-frame">
      <ScrollView
        horizontal
        nestedScrollEnabled
        bounces={false}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        testID="message-markdown-table-scroll"
      >
        <View style={[styles.tableSurface, tableStyle, tableSurfaceStyle]}>
          <View style={[styles.row, rowStyle]}>
            {header.map((headerCell, index) => {
              const columnStyle = {
                width: widthArr[index],
                minWidth: widthArr[index],
                borderTopWidth: borderWidth,
                borderRightWidth: borderWidth,
                borderColor,
              } as const;

              return (
                <View
                  key={`header-${index}`}
                  style={[styles.cell, styles.headerCell, cellStyle, columnStyle]}
                >
                  {headerCell}
                </View>
              );
            })}
          </View>

          {rows.map((rowData, rowIndex) => (
            <View key={`row-${rowIndex}`} style={[styles.row, rowStyle]}>
              {rowData.map((cellData, cellIndex) => {
                const columnStyle = {
                  width: widthArr[cellIndex],
                  minWidth: widthArr[cellIndex],
                  borderTopWidth: borderWidth,
                  borderRightWidth: borderWidth,
                  borderColor,
                } as const;

                return (
                  <View
                    key={`cell-${rowIndex}-${cellIndex}`}
                    style={[styles.cell, cellStyle, columnStyle]}
                  >
                    {cellData}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

class MessageMarkdownRenderer extends Renderer {
  private readonly colors: AppPalette;

  private readonly isUser: boolean;

  constructor(colors: AppPalette, isUser: boolean) {
    super();
    this.colors = colors;
    this.isUser = isUser;
  }

  override table(
    header: ReactNode[][],
    rows: ReactNode[][][],
    tableStyle?: ViewStyle,
    rowStyle?: ViewStyle,
    cellStyle?: ViewStyle,
  ): ReactNode {
    return (
      <MessageMarkdownTable
        key={this.getKey()}
        header={header}
        rows={rows}
        tableStyle={tableStyle}
        rowStyle={rowStyle}
        cellStyle={cellStyle}
        colors={this.colors}
        isUser={this.isUser}
      />
    );
  }
}

export function createMessageMarkdownRenderer(
  colors: AppPalette,
  isUser: boolean,
): RendererInterface {
  return new MessageMarkdownRenderer(colors, isUser);
}

const createStyles = (colors: AppPalette, isUser: boolean) =>
  StyleSheet.create({
    frame: {
      minWidth: 0,
      maxWidth: '100%',
      alignSelf: 'stretch',
      flexGrow: 0,
      flexShrink: 1,
      overflow: 'hidden',
    },
    scroll: {
      minWidth: 0,
      maxWidth: '100%',
      alignSelf: 'stretch',
      flexGrow: 0,
      flexShrink: 1,
    },
    scrollContent: {
      flexGrow: 0,
      alignSelf: 'flex-start',
    },
    tableSurface: {
      alignSelf: 'flex-start',
      backgroundColor: isUser ? 'rgba(255,255,255,0.06)' : colors.surfaceAlt,
    },
    row: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
    },
    cell: {
      justifyContent: 'center',
      flexShrink: 0,
      minWidth: 0,
    },
    headerCell: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.08)' : colors.surface,
    },
  });
