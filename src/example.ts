/**
 * 预置的可编辑示例，记谱（measures）覆盖六种典型情况：
 *  1. 时值正确（含附点与三连音）
 *  2. 超出（演示首个越界叶事件定位）
 *  3. 不足 7/8（演示休止符补全建议：附点二分 + 二分，事件数最少且较长优先）
 *  4. 时值正确（两层连音嵌套）
 *  5. 不足 1/64（缺口无法用允许休止符精确组成 → 不可补足提示，不给近似）
 *  6. 时值正确但与参考轮廓不同，且每个记谱叶覆盖的参考状态恒定 → 按参考修正记谱（note/rest 切换）
 * 参考演奏（referenceMeasures）演示对照：
 *  1. 事件拆分不同但轮廓一致（1/4 拆成两个 1/8）
 *  2. 参考时值正确，但记谱超出 → 仅显示时值问题
 *  3. 参考时值正确，但记谱不足 → 仅显示时值问题，记谱侧可预览/应用补全建议
 *  4. 两侧时值均正确但轮廓不同，参考状态在记谱叶内部变化 → 无法仅改类型修正，不给部分方案
 *  5. 参考时值正确，但记谱不足 1/64 → 记谱侧显示不可补足提示
 *  6. 参考将第 2、4 个四分音符位置改为休止符 → 修正方案切换 measures[5].events[1] 与 [3]
 */
export const EXAMPLE_JSON = `{
  "timeSignature": { "numerator": 4, "denominator": 4 },
  "measures": [
    {
      "events": [
        { "type": "note", "denominator": 4 },
        { "type": "note", "denominator": 4, "dot": true },
        { "type": "rest", "denominator": 8 },
        {
          "type": "tuplet",
          "actual": 3,
          "inTimeOf": 2,
          "events": [
            { "type": "note", "denominator": 8 },
            { "type": "note", "denominator": 8 },
            { "type": "note", "denominator": 8 }
          ]
        }
      ]
    },
    {
      "events": [
        { "type": "note", "denominator": 2 },
        { "type": "note", "denominator": 2 },
        { "type": "note", "denominator": 8 }
      ]
    },
    {
      "events": [
        { "type": "note", "denominator": 8 }
      ]
    },
    {
      "events": [
        { "type": "note", "denominator": 2 },
        {
          "type": "tuplet",
          "actual": 3,
          "inTimeOf": 2,
          "events": [
            { "type": "note", "denominator": 4 },
            {
              "type": "tuplet",
              "actual": 3,
              "inTimeOf": 2,
              "events": [
                { "type": "note", "denominator": 8 },
                { "type": "note", "denominator": 8 },
                { "type": "note", "denominator": 8 }
              ]
            },
            { "type": "note", "denominator": 4 }
          ]
        }
      ]
    },
    {
      "events": [
        {
          "type": "tuplet",
          "actual": 64,
          "inTimeOf": 63,
          "events": [
            { "type": "note", "denominator": 1 }
          ]
        }
      ]
    },
    {
      "events": [
        { "type": "note", "denominator": 4 },
        { "type": "note", "denominator": 4 },
        { "type": "note", "denominator": 4 },
        { "type": "note", "denominator": 4 }
      ]
    }
  ],
  "referenceMeasures": [
    {
      "events": [
        { "type": "note", "denominator": 8 },
        { "type": "note", "denominator": 8 },
        { "type": "note", "denominator": 4, "dot": true },
        { "type": "rest", "denominator": 8 },
        {
          "type": "tuplet",
          "actual": 3,
          "inTimeOf": 2,
          "events": [
            { "type": "note", "denominator": 8 },
            { "type": "note", "denominator": 8 },
            { "type": "note", "denominator": 8 }
          ]
        }
      ]
    },
    {
      "events": [
        { "type": "note", "denominator": 2 },
        { "type": "rest", "denominator": 4 },
        { "type": "note", "denominator": 4 }
      ]
    },
    {
      "events": [
        { "type": "note", "denominator": 2 },
        { "type": "rest", "denominator": 2 }
      ]
    },
    {
      "events": [
        { "type": "note", "denominator": 2 },
        { "type": "rest", "denominator": 4 },
        { "type": "note", "denominator": 4 }
      ]
    },
    {
      "events": [
        { "type": "note", "denominator": 1 }
      ]
    },
    {
      "events": [
        { "type": "note", "denominator": 4 },
        { "type": "rest", "denominator": 4 },
        { "type": "note", "denominator": 4 },
        { "type": "rest", "denominator": 4 }
      ]
    }
  ]
}
`;
