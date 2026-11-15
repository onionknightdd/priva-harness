# Component catalog

Generated from the renderer catalog by scripts/generate-dashboard-catalog.ts. Do not edit the schema below by hand.

Use named Express arguments matching these properties. Omit the protocol-only `component` field. `required` lists required arguments; other arguments are optional. Unknown properties are rejected.

`DynamicString` means a literal string or an initialized absolute string binding such as `$/title`. `ChildList` must be an explicit list of component references. `Action` must use the explicit event map shown in interactions.md, including a readable userMessage. Input values must bind to initialized strings. Chart series lengths and table row widths must match their labels or columns.

The host always creates the main surface: assign `root = Component(...)`; never emit `surface(...)`.

```json
{
  "Column": {
    "type": "object",
    "properties": {
      "component": {
        "const": "Column"
      },
      "children": {
        "$ref": "common_types.json#/$defs/ChildList"
      },
      "gap": {
        "type": "string",
        "enum": [
          "small",
          "medium",
          "large"
        ]
      }
    },
    "required": [
      "component",
      "children"
    ],
    "unevaluatedProperties": false
  },
  "Row": {
    "type": "object",
    "properties": {
      "component": {
        "const": "Row"
      },
      "children": {
        "$ref": "common_types.json#/$defs/ChildList"
      }
    },
    "required": [
      "component",
      "children"
    ],
    "unevaluatedProperties": false
  },
  "Grid": {
    "type": "object",
    "properties": {
      "component": {
        "const": "Grid"
      },
      "children": {
        "$ref": "common_types.json#/$defs/ChildList"
      },
      "columns": {
        "type": "integer",
        "minimum": 1,
        "maximum": 4
      }
    },
    "required": [
      "component",
      "children"
    ],
    "unevaluatedProperties": false
  },
  "Heading": {
    "type": "object",
    "properties": {
      "component": {
        "const": "Heading"
      },
      "text": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "subtitle": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "eyebrow": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      }
    },
    "required": [
      "component",
      "text"
    ],
    "unevaluatedProperties": false
  },
  "Text": {
    "type": "object",
    "properties": {
      "component": {
        "const": "Text"
      },
      "text": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "tone": {
        "type": "string",
        "enum": [
          "default",
          "muted",
          "positive",
          "negative"
        ]
      }
    },
    "required": [
      "component",
      "text"
    ],
    "unevaluatedProperties": false
  },
  "Stat": {
    "type": "object",
    "properties": {
      "component": {
        "const": "Stat"
      },
      "label": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "value": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "delta": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "caption": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "trend": {
        "type": "string",
        "enum": [
          "up",
          "down",
          "neutral"
        ]
      }
    },
    "required": [
      "component",
      "label",
      "value"
    ],
    "unevaluatedProperties": false
  },
  "Card": {
    "type": "object",
    "properties": {
      "component": {
        "const": "Card"
      },
      "children": {
        "$ref": "common_types.json#/$defs/ChildList"
      },
      "title": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "description": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      }
    },
    "required": [
      "component",
      "children"
    ],
    "unevaluatedProperties": false
  },
  "Badge": {
    "type": "object",
    "properties": {
      "component": {
        "const": "Badge"
      },
      "text": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "tone": {
        "type": "string",
        "enum": [
          "default",
          "muted",
          "positive",
          "negative"
        ]
      }
    },
    "required": [
      "component",
      "text"
    ],
    "unevaluatedProperties": false
  },
  "Table": {
    "type": "object",
    "properties": {
      "component": {
        "const": "Table"
      },
      "columns": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "minItems": 1,
        "maxItems": 12
      },
      "rows": {
        "type": "array",
        "items": {
          "type": "array",
          "items": {
            "oneOf": [
              {
                "type": "string"
              },
              {
                "type": "number"
              }
            ]
          },
          "maxItems": 12
        },
        "maxItems": 200
      },
      "title": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      }
    },
    "required": [
      "component",
      "columns",
      "rows"
    ],
    "unevaluatedProperties": false
  },
  "BarChart": {
    "type": "object",
    "properties": {
      "component": {
        "const": "BarChart"
      },
      "title": {
        "description": "A concise chart title.",
        "oneOf": [
          {
            "type": "string"
          },
          {
            "$ref": "common_types.json#/$defs/DataBinding"
          },
          {
            "$ref": "common_types.json#/$defs/FunctionCall",
            "description": "Invokes a named function, combining common function properties with the catalog function definition."
          }
        ]
      },
      "labels": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "minItems": 1,
        "maxItems": 60,
        "description": "Category labels, in display order."
      },
      "series": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string"
            },
            "values": {
              "type": "array",
              "items": {
                "type": "number"
              },
              "minItems": 1,
              "maxItems": 60
            }
          },
          "required": [
            "name",
            "values"
          ],
          "additionalProperties": false
        },
        "minItems": 1,
        "maxItems": 6,
        "description": "Each series must have exactly one value for every label."
      },
      "description": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "format": {
        "type": "string",
        "enum": [
          "number",
          "currency",
          "percent"
        ]
      },
      "unit": {
        "type": "string",
        "maxLength": 12,
        "description": "Optional displayed unit suffix, e.g. M for millions. Currency uses $."
      }
    },
    "required": [
      "component",
      "title",
      "labels",
      "series"
    ],
    "unevaluatedProperties": false
  },
  "LineChart": {
    "type": "object",
    "properties": {
      "component": {
        "const": "LineChart"
      },
      "title": {
        "description": "A concise chart title.",
        "oneOf": [
          {
            "type": "string"
          },
          {
            "$ref": "common_types.json#/$defs/DataBinding"
          },
          {
            "$ref": "common_types.json#/$defs/FunctionCall",
            "description": "Invokes a named function, combining common function properties with the catalog function definition."
          }
        ]
      },
      "labels": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "minItems": 1,
        "maxItems": 60,
        "description": "Category labels, in display order."
      },
      "series": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string"
            },
            "values": {
              "type": "array",
              "items": {
                "type": "number"
              },
              "minItems": 1,
              "maxItems": 60
            }
          },
          "required": [
            "name",
            "values"
          ],
          "additionalProperties": false
        },
        "minItems": 1,
        "maxItems": 6,
        "description": "Each series must have exactly one value for every label."
      },
      "description": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "format": {
        "type": "string",
        "enum": [
          "number",
          "currency",
          "percent"
        ]
      },
      "unit": {
        "type": "string",
        "maxLength": 12,
        "description": "Optional displayed unit suffix, e.g. M for millions. Currency uses $."
      }
    },
    "required": [
      "component",
      "title",
      "labels",
      "series"
    ],
    "unevaluatedProperties": false
  },
  "AreaChart": {
    "type": "object",
    "properties": {
      "component": {
        "const": "AreaChart"
      },
      "title": {
        "description": "A concise chart title.",
        "oneOf": [
          {
            "type": "string"
          },
          {
            "$ref": "common_types.json#/$defs/DataBinding"
          },
          {
            "$ref": "common_types.json#/$defs/FunctionCall",
            "description": "Invokes a named function, combining common function properties with the catalog function definition."
          }
        ]
      },
      "labels": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "minItems": 1,
        "maxItems": 60,
        "description": "Category labels, in display order."
      },
      "series": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string"
            },
            "values": {
              "type": "array",
              "items": {
                "type": "number"
              },
              "minItems": 1,
              "maxItems": 60
            }
          },
          "required": [
            "name",
            "values"
          ],
          "additionalProperties": false
        },
        "minItems": 1,
        "maxItems": 6,
        "description": "Each series must have exactly one value for every label."
      },
      "description": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "format": {
        "type": "string",
        "enum": [
          "number",
          "currency",
          "percent"
        ]
      },
      "unit": {
        "type": "string",
        "maxLength": 12,
        "description": "Optional displayed unit suffix, e.g. M for millions. Currency uses $."
      }
    },
    "required": [
      "component",
      "title",
      "labels",
      "series"
    ],
    "unevaluatedProperties": false
  },
  "DonutChart": {
    "type": "object",
    "properties": {
      "component": {
        "const": "DonutChart"
      },
      "title": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "labels": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "minItems": 1,
        "maxItems": 12
      },
      "values": {
        "type": "array",
        "items": {
          "type": "number",
          "minimum": 0
        },
        "minItems": 1,
        "maxItems": 12
      },
      "description": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "format": {
        "type": "string",
        "enum": [
          "number",
          "currency",
          "percent"
        ]
      },
      "unit": {
        "type": "string",
        "maxLength": 12
      }
    },
    "required": [
      "component",
      "title",
      "labels",
      "values"
    ],
    "unevaluatedProperties": false
  },
  "Button": {
    "type": "object",
    "properties": {
      "component": {
        "const": "Button"
      },
      "label": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "action": {
        "$ref": "common_types.json#/$defs/Action",
        "description": "Defines an interaction handler that can either trigger an agent-side event or execute a local renderer-side function."
      },
      "variant": {
        "type": "string",
        "enum": [
          "default",
          "outline",
          "secondary"
        ]
      }
    },
    "required": [
      "component",
      "label",
      "action"
    ],
    "unevaluatedProperties": false
  },
  "TextField": {
    "type": "object",
    "properties": {
      "component": {
        "const": "TextField"
      },
      "label": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "value": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "placeholder": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      }
    },
    "required": [
      "component",
      "label",
      "value"
    ],
    "unevaluatedProperties": false
  },
  "Select": {
    "type": "object",
    "properties": {
      "component": {
        "const": "Select"
      },
      "label": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "value": {
        "$ref": "common_types.json#/$defs/DynamicString",
        "description": "Represents a string"
      },
      "options": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "label": {
              "type": "string"
            },
            "value": {
              "type": "string"
            }
          },
          "required": [
            "label",
            "value"
          ],
          "additionalProperties": false
        },
        "minItems": 1,
        "maxItems": 50
      }
    },
    "required": [
      "component",
      "label",
      "value",
      "options"
    ],
    "unevaluatedProperties": false
  }
}
```
