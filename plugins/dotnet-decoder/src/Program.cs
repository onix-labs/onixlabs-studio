// The .NET decoder plugin: reads a managed assembly's IL and speaks the decoder protocol.
//
// Protocol: newline-delimited JSON on standard streams, one request per line in, one response per line
// out. The assembly arrives base64-encoded and is authoritative — the caller may be showing unsaved
// edits, so nothing is ever read from disk.
//
// This decoder needs the WHOLE file rather than a window: ECMA-335 metadata is a set of cross-
// referencing tables and a method body is located through them, so a viewport-sized slice cannot be
// interpreted at all. It says so in its describe response, and the caller sends everything.

using System.Reflection.Emit;
using OperandType = System.Reflection.Emit.OperandType;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Text.Json;
using System.Text.Json.Serialization;
using ICSharpCode.Decompiler.Metadata;

namespace OnixLabs.DotnetDecoder;

/// <summary>Represents one row of a listing, matching the shared ListingRow contract.</summary>
internal sealed record Row(
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("address")] int Address,
    [property: JsonPropertyName("fileOffset")] int? FileOffset,
    [property: JsonPropertyName("mnemonic")] string Mnemonic,
    [property: JsonPropertyName("operands")] string Operands,
    [property: JsonPropertyName("comment")] string? Comment,
    [property: JsonPropertyName("sourceLine")] int? SourceLine);

/// <summary>Represents a section's byte range in the backing file.</summary>
internal sealed record FileRange(
    [property: JsonPropertyName("start")] int Start,
    [property: JsonPropertyName("length")] int Length);

/// <summary>Represents one section of a listing — one method.</summary>
internal sealed record Section(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("fileRange")] FileRange? FileRange,
    [property: JsonPropertyName("notes")] string[]? Notes,
    [property: JsonPropertyName("rows")] Row[] Rows);

internal static class Program
{
    /// <summary>Holds the protocol version this decoder speaks.</summary>
    private const string Protocol = "1.0";

    /// <summary>
    /// Holds the most methods one listing will carry.
    ///
    /// A large assembly has tens of thousands, and every one of them would cross the wire and be laid
    /// out before the reader could look at the first. Truncating is stated in the listing rather than
    /// done silently.
    /// </summary>
    private const int MaxSections = 2000;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>
    /// Maps opcode value to the reflected opcode, so neither mnemonics nor operand sizes are
    /// hand-rolled. Two-byte opcodes are keyed by their 0xFE-prefixed value.
    /// </summary>
    private static readonly Dictionary<int, OpCode> OpCodes = BuildOpCodes();

    private static int Main()
    {
        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            object response;
            int id = 0;
            try
            {
                using JsonDocument request = JsonDocument.Parse(line);
                JsonElement root = request.RootElement;
                id = root.TryGetProperty("id", out JsonElement idElement) ? idElement.GetInt32() : 0;
                response = Handle(id, root);
            }
            catch (Exception error)
            {
                response = new { id, ok = false, error = $"{error.GetType().Name}: {error.Message}" };
            }

            Console.WriteLine(JsonSerializer.Serialize(response, JsonOptions));
            Console.Out.Flush();
        }

        return 0;
    }

    /// <summary>Handles one request.</summary>
    private static object Handle(int id, JsonElement request)
    {
        string op = request.GetProperty("op").GetString() ?? "";
        if (op == "describe")
        {
            return new
            {
                id,
                ok = true,
                description = new
                {
                    protocol = Protocol,
                    formats = new[] { "pe-managed" },
                    // Metadata is a set of cross-referencing tables; a windowed slice is not readable.
                    requiresWholeFile = true,
                },
            };
        }

        if (op != "decode")
        {
            return new { id, ok = false, error = $"unknown op '{op}'" };
        }

        string format = request.TryGetProperty("format", out JsonElement f) ? f.GetString() ?? "" : "";
        if (format != "pe-managed")
        {
            return new { id, ok = false, error = $"unsupported format '{format}'" };
        }

        byte[] bytes = Convert.FromBase64String(request.GetProperty("bytes").GetString() ?? "");
        int baseOffset = request.TryGetProperty("baseOffset", out JsonElement b) ? b.GetInt32() : 0;
        if (baseOffset != 0)
        {
            return new
            {
                id,
                ok = false,
                error = "this decoder needs the whole assembly, not a window",
            };
        }

        string? path = request.TryGetProperty("path", out JsonElement p) ? p.GetString() : null;
        byte[]? pdb = ReadCompanion(request, "pdb");
        return new { id, ok = true, listing = BuildListing(bytes, path, pdb) };
    }

    /// <summary>Builds the listing for a whole assembly, one section per method with a body.</summary>
    private static object BuildListing(byte[] bytes, string? path, byte[]? pdb)
    {
        // The source mapping lives in the PDB, not the assembly. Without one the listing is still
        // correct, just without line numbers — which is the ordinary case for a release build.
        Dictionary<int, Dictionary<int, int>> sequencePoints = ReadSequencePoints(pdb);
        using MemoryStream stream = new(bytes, writable: false);
        using PEFile file = new(path ?? "assembly", stream);
        MetadataReader metadata = file.Metadata;

        List<Section> sections = [];
        bool truncated = false;

        foreach (MethodDefinitionHandle handle in metadata.MethodDefinitions)
        {
            if (sections.Count >= MaxSections)
            {
                truncated = true;
                break;
            }

            MethodDefinition definition = metadata.GetMethodDefinition(handle);
            string name = metadata.GetString(definition.Name);
            TypeDefinition declaring = metadata.GetTypeDefinition(definition.GetDeclaringType());
            string typeName = metadata.GetString(declaring.Name);
            int token = MetadataTokens.GetToken(handle);
            string title = $"{typeName}.{name}";

            if (definition.RelativeVirtualAddress == 0)
            {
                sections.Add(new Section(
                    token.ToString(), title, null, ["abstract or extern — no IL body"], []));
                continue;
            }

            MethodBodyBlock body = file.GetMethodBody(definition.RelativeVirtualAddress);
            byte[] il = body.GetILBytes() ?? [];

            // The IL body's file offset, so the hex grid can cross-highlight what a row decodes from:
            // the RVA maps through the containing section, then past the method header (tiny = 1 byte,
            // fat = 12).
            int headerOffset = RvaToFileOffset(file, definition.RelativeVirtualAddress);
            int ilOffset = -1;
            int headerSize = 0;
            if (headerOffset >= 0 && headerOffset < bytes.Length)
            {
                headerSize = (bytes[headerOffset] & 0x03) == 0x02 ? 1 : 12;
                ilOffset = headerOffset + headerSize;
            }

            sections.Add(new Section(
                token.ToString(),
                title,
                ilOffset >= 0 ? new FileRange(ilOffset, il.Length) : null,
                [
                    $"token=0x{token:X8}, maxStack={body.MaxStack}, header={headerSize}b, {il.Length} bytes of IL",
                    sequencePoints.ContainsKey(token)
                        ? "source lines from the portable PDB"
                        : "no source mapping",
                ],
                DecodeIl(il, ilOffset, metadata,
                    sequencePoints.TryGetValue(token, out Dictionary<int, int>? lines) ? lines : null)));
        }

        if (truncated)
        {
            sections.Add(new Section(
                "truncated",
                $"… {MaxSections}-method limit reached; the rest of this assembly is not shown",
                null,
                null,
                []));
        }

        return new
        {
            language = ".NET IL",
            addressing = "method-relative",
            origin = new { kind = "buffer", path },
            sections,
        };
    }

    /// <summary>Decodes a method body's IL into listing rows.</summary>
    private static Row[] DecodeIl(
        byte[] il, int ilFileOffset, MetadataReader metadata, Dictionary<int, int>? lines)
    {
        List<Row> rows = [];
        int position = 0;
        int? currentLine = null;

        while (position < il.Length)
        {
            int start = position;
            // A sequence point marks where a source statement begins; the rows after it belong to that
            // statement until the next one, which is what makes a caret-to-instruction sync possible.
            if (lines is not null && lines.TryGetValue(start, out int line))
            {
                currentLine = line;
            }

            int key;
            if (il[position] == 0xFE && position + 1 < il.Length)
            {
                key = 0xFE00 | il[position + 1];
                position += 2;
            }
            else
            {
                key = il[position];
                position += 1;
            }

            if (!OpCodes.TryGetValue(key, out OpCode opCode))
            {
                rows.Add(Filler(start, ilFileOffset, il[start], currentLine));
                position = start + 1;
                continue;
            }

            int size = OperandSize(opCode.OperandType, il, position);
            if (position + size > il.Length)
            {
                rows.Add(Filler(start, ilFileOffset, il[start], currentLine));
                position = start + 1;
                continue;
            }

            (string operands, string? comment) = ReadOperand(opCode, il, position, size, metadata);
            position += size;
            rows.Add(new Row(
                "instruction",
                start,
                ilFileOffset < 0 ? null : ilFileOffset + start,
                opCode.Name ?? "?",
                operands,
                comment,
                currentLine));
        }

        return [.. rows];
    }

    /// <summary>Builds a filler row for a byte that is not a known opcode.</summary>
    private static Row Filler(int offset, int ilFileOffset, byte value, int? sourceLine) => new(
        "instruction",
        offset,
        ilFileOffset < 0 ? null : ilFileOffset + offset,
        ".byte",
        $"0x{value:X2}",
        null,
        sourceLine);

    /// <summary>Builds the opcode table by reflecting over the framework's own opcode definitions.</summary>
    private static Dictionary<int, OpCode> BuildOpCodes()
    {
        Dictionary<int, OpCode> table = [];
        foreach (System.Reflection.FieldInfo field in typeof(System.Reflection.Emit.OpCodes)
                     .GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static))
        {
            if (field.GetValue(null) is OpCode opCode)
            {
                table[(ushort)opCode.Value] = opCode;
            }
        }

        return table;
    }

    /// <summary>Returns an operand's byte length.</summary>
    private static int OperandSize(OperandType type, byte[] il, int position) => type switch
    {
        OperandType.InlineNone => 0,
        OperandType.ShortInlineBrTarget => 1,
        OperandType.ShortInlineI => 1,
        OperandType.ShortInlineVar => 1,
        OperandType.InlineVar => 2,
        OperandType.InlineI8 => 8,
        OperandType.InlineR => 8,
        OperandType.InlineSwitch => position + 4 <= il.Length
            ? 4 + BitConverter.ToInt32(il, position) * 4
            : 4,
        _ => 4,
    };

    /// <summary>Renders an instruction's operand, with an ildasm-style comment for a token.</summary>
    private static (string Operands, string? Comment) ReadOperand(
        OpCode opCode, byte[] il, int position, int size, MetadataReader metadata)
    {
        int next = position + size;
        switch (opCode.OperandType)
        {
            case OperandType.InlineNone:
                return ("", null);
            case OperandType.ShortInlineI:
            case OperandType.ShortInlineVar:
                return (il[position].ToString(), null);
            case OperandType.ShortInlineBrTarget:
                return ($"IL_{next + (sbyte)il[position]:X4}", null);
            case OperandType.InlineBrTarget:
                return ($"IL_{next + BitConverter.ToInt32(il, position):X4}", null);
            case OperandType.InlineVar:
                return (BitConverter.ToUInt16(il, position).ToString(), null);
            case OperandType.InlineI:
                return (BitConverter.ToInt32(il, position).ToString(), null);
            case OperandType.ShortInlineR:
                return (BitConverter.ToSingle(il, position).ToString(), null);
            case OperandType.InlineI8:
                return (BitConverter.ToInt64(il, position).ToString(), null);
            case OperandType.InlineR:
                return (BitConverter.ToDouble(il, position).ToString(), null);
            case OperandType.InlineSwitch:
                return ($"({BitConverter.ToInt32(il, position)} targets)", null);
            default:
            {
                int token = BitConverter.ToInt32(il, position);
                return ($"0x{token:X8}", ResolveToken(metadata, token));
            }
        }
    }

    /// <summary>Resolves a metadata token to a readable name, the way ildasm's comments do.</summary>
    private static string? ResolveToken(MetadataReader metadata, int token)
    {
        try
        {
            if ((token >> 24) == 0x70)
            {
                string text = metadata.GetUserString(MetadataTokens.UserStringHandle(token));
                return $"\"{(text.Length > 60 ? text[..60] + "…" : text)}\"";
            }

            EntityHandle handle = MetadataTokens.EntityHandle(token);
            return handle.Kind switch
            {
                HandleKind.MethodDefinition => Qualify(metadata,
                    metadata.GetMethodDefinition((MethodDefinitionHandle)handle)),
                HandleKind.MemberReference => metadata.GetString(
                    metadata.GetMemberReference((MemberReferenceHandle)handle).Name),
                HandleKind.TypeReference => metadata.GetString(
                    metadata.GetTypeReference((TypeReferenceHandle)handle).Name),
                HandleKind.TypeDefinition => metadata.GetString(
                    metadata.GetTypeDefinition((TypeDefinitionHandle)handle).Name),
                HandleKind.FieldDefinition => metadata.GetString(
                    metadata.GetFieldDefinition((FieldDefinitionHandle)handle).Name),
                _ => null,
            };
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Names a method as `Type.Method`, which is what makes a call worth reading.</summary>
    private static string Qualify(MetadataReader metadata, MethodDefinition definition)
    {
        TypeDefinition declaring = metadata.GetTypeDefinition(definition.GetDeclaringType());
        return $"{metadata.GetString(declaring.Name)}.{metadata.GetString(definition.Name)}";
    }

    /// <summary>Reads a named companion file from a request, or null when it was not supplied.</summary>
    private static byte[]? ReadCompanion(JsonElement request, string name)
    {
        if (!request.TryGetProperty("companions", out JsonElement companions) ||
            companions.ValueKind != JsonValueKind.Object ||
            !companions.TryGetProperty(name, out JsonElement value))
        {
            return null;
        }

        string? encoded = value.GetString();
        return string.IsNullOrEmpty(encoded) ? null : Convert.FromBase64String(encoded);
    }

    /// <summary>
    /// Reads a portable PDB's sequence points, giving each method's IL offsets their source lines.
    ///
    /// Hidden sequence points are skipped: they mark compiler-generated code that belongs to no line,
    /// and attributing them to the previous statement would make the sync jump about.
    /// </summary>
    private static Dictionary<int, Dictionary<int, int>> ReadSequencePoints(byte[]? pdb)
    {
        Dictionary<int, Dictionary<int, int>> result = [];
        if (pdb is null || pdb.Length == 0)
        {
            return result;
        }

        try
        {
            using MemoryStream stream = new(pdb, writable: false);
            using MetadataReaderProvider provider = MetadataReaderProvider.FromPortablePdbStream(stream);
            MetadataReader reader = provider.GetMetadataReader();

            foreach (MethodDebugInformationHandle handle in reader.MethodDebugInformation)
            {
                MethodDebugInformation info = reader.GetMethodDebugInformation(handle);
                if (info.SequencePointsBlob.IsNil)
                {
                    continue;
                }

                Dictionary<int, int> lines = [];
                foreach (SequencePoint point in info.GetSequencePoints())
                {
                    if (!point.IsHidden)
                    {
                        lines[point.Offset] = point.StartLine;
                    }
                }

                if (lines.Count > 0)
                {
                    result[MetadataTokens.GetToken(handle.ToDefinitionHandle())] = lines;
                }
            }
        }
        catch
        {
            // A PDB that does not match the assembly, or is not portable, is no worse than none.
            return [];
        }

        return result;
    }

    /// <summary>Translates a relative virtual address to a file offset via the containing section.</summary>
    private static int RvaToFileOffset(PEFile file, int rva)
    {
        var headers = file.Reader.PEHeaders;
        int index = headers.GetContainingSectionIndex(rva);
        if (index < 0)
        {
            return -1;
        }

        var section = headers.SectionHeaders[index];
        return rva - section.VirtualAddress + section.PointerToRawData;
    }
}
