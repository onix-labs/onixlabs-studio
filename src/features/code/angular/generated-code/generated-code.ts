import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { CodeListing, ListingSection } from '@shared/api/code-listing';
import { decoderFormatKey } from '@shared/api/decoder-protocol';
import { ProjectChannel } from '@shared/api/project-channels';
import { CompiledArtifact } from '@shared/api/project-system';
import { BinaryChunk } from '@shared/api/workspace-channels';
import { Decoders } from '@shared/angular/services/decoders/decoders';
import { Log } from '@shared/angular/services/log/log';
import { Workspace } from '@shared/angular/services/workspace/workspace';

/**
 * Specifies the largest artefact that will be read and decoded. Metadata decoders need the whole file,
 * so this is a guard against a pathological output rather than a limit anyone should meet.
 */
const MAX_ARTIFACT_BYTES: number = 64 * 1024 * 1024;

/**
 * Specifies the largest symbol file that will be read alongside an artefact.
 */
const MAX_SYMBOLS_BYTES: number = 32 * 1024 * 1024;

/**
 * Describes what the generated-code panel has to show for a source file.
 *
 * The three unhappy outcomes are distinct states rather than one empty result, because they call for
 * different things from the user: build the project, install a decoder, or nothing at all.
 */
export type GeneratedCode =
  /**
   * The file belongs to no project this build can resolve an artefact for.
   */
  | { readonly kind: 'unsupported' }
  /**
   * The project resolves but has not been built, so there is nothing to read yet.
   */
  | { readonly kind: 'not-built' }
  /**
   * The artefact exists but no decoder for its format is installed.
   */
  | { readonly kind: 'no-decoder'; readonly artifactPath: string }
  /**
   * The artefact decoded, filtered to the methods belonging to this source file.
   */
  | {
      readonly kind: 'listing';
      readonly listing: CodeListing;
      readonly artifactPath: string;
      readonly stale: boolean;
      readonly matched: boolean;
    };

/**
 * Resolves what an open source file compiled into, and decodes it.
 *
 * Three steps, each of which can fail in a way worth reporting differently: ask the project system for
 * the artefact (without building), read it and its symbols through the workspace gate, and hand the
 * bytes to whichever decoder claims its format.
 */
@Service()
export class GeneratedCodeResolver {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the workspace client the artefact and its symbols are read through — the same gate the
   * binary editor reads a file through, so this reaches nothing a user has not opened.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the shared decoder client.
   */
  private readonly decoders: Decoders = inject(Decoders);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Resolves and decodes the generated code for a source file.
   * @param sourcePath The absolute path of the open source file.
   * @returns Returns what the panel should show.
   */
  public async resolve(sourcePath: string): Promise<GeneratedCode> {
    const artifact: CompiledArtifact | null = await this.resolveArtifact(sourcePath);
    if (artifact === null) {
      // The project system answers null both for "no project" and "never built"; without a build there
      // is no artefact to distinguish them by, so this reports the actionable one.
      return { kind: 'not-built' };
    }

    const bytes: Uint8Array | null = await this.read(artifact.artifactPath, MAX_ARTIFACT_BYTES);
    if (bytes === null) {
      return { kind: 'not-built' };
    }

    const format: string | null = artifactFormat(artifact.artifactPath, bytes);
    if (format === null) {
      return { kind: 'unsupported' };
    }
    if ((await this.decoders.info(format)) === null) {
      return { kind: 'no-decoder', artifactPath: artifact.artifactPath };
    }

    const companions: Readonly<Record<string, Uint8Array>> | undefined =
      await this.readSymbols(artifact);
    const listing: CodeListing | null = await this.decoders.decode(
      format,
      bytes,
      0,
      bytes.length,
      artifact.artifactPath,
      companions,
    );
    if (listing === null) {
      return { kind: 'no-decoder', artifactPath: artifact.artifactPath };
    }

    const filtered: CodeListing = filterToSource(listing, sourcePath);
    return {
      kind: 'listing',
      listing: filtered,
      artifactPath: artifact.artifactPath,
      stale: artifact.stale,
      // Whether anything actually belonged to this file, so the panel can tell "nothing here" from
      // "the decoder could not say where anything came from".
      matched: filtered.sections.length > 0,
    };
  }

  /**
   * Asks the project system what a source file's project produces.
   * @param sourcePath The source file.
   * @returns Returns the artefact, or null.
   */
  private async resolveArtifact(sourcePath: string): Promise<CompiledArtifact | null> {
    if (this.bridge === undefined) {
      return null;
    }
    try {
      return await this.bridge.invoke<CompiledArtifact | null>(
        ProjectChannel.ArtifactResolve,
        sourcePath,
        undefined,
      );
    } catch (error: unknown) {
      this.log.debug('code.generated', 'Artefact resolution failed', error);
      return null;
    }
  }

  /**
   * Reads the symbols beside an artefact, when it has any.
   * @param artifact The resolved artefact.
   * @returns Returns the companions, or undefined when there are no symbols.
   */
  private async readSymbols(
    artifact: CompiledArtifact,
  ): Promise<Readonly<Record<string, Uint8Array>> | undefined> {
    if (artifact.symbolsPath === null) {
      return undefined;
    }
    const bytes: Uint8Array | null = await this.read(artifact.symbolsPath, MAX_SYMBOLS_BYTES);
    return bytes === null ? undefined : { pdb: bytes };
  }

  /**
   * Reads a file through the workspace gate.
   * @param path The absolute path.
   * @param limit The most bytes to read.
   * @returns Returns the bytes, or null when the file could not be read.
   */
  private async read(path: string, limit: number): Promise<Uint8Array | null> {
    const chunk: BinaryChunk | null = await this.workspace.readBytes(path, 0, limit);
    return chunk === null || chunk.bytes.length === 0 ? null : new Uint8Array(chunk.bytes);
  }
}

/**
 * Works out which decoder format an artefact is, from its bytes.
 *
 * Sniffed rather than taken from the extension: a `.dll` may be managed or native, and only its header
 * says which.
 * @param artifactPath The artefact path, used for the class-file case where the extension is decisive.
 * @param bytes The artefact's leading bytes.
 * @returns Returns the format key, or null when nothing decodes it.
 */
function artifactFormat(artifactPath: string, bytes: Uint8Array): string | null {
  if (artifactPath.toLowerCase().endsWith('.class')) {
    return decoderFormatKey('jvm');
  }
  // PE with a CLR data directory: a managed assembly.
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) {
    return 'pe-managed';
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d) {
    return decoderFormatKey('wasm');
  }
  if (bytes[0] === 0xca && bytes[1] === 0xfe && bytes[2] === 0xba && bytes[3] === 0xbe) {
    return decoderFormatKey('jvm');
  }
  return null;
}

/**
 * Narrows a listing to the sections compiled from one source file.
 *
 * .NET reports an absolute path and JVM reports a bare file name — a class file records no directory —
 * so the two are compared differently rather than pretending they are the same kind of value. A
 * listing whose sections say nothing about their origin is returned whole rather than emptied: showing
 * everything is a worse answer than showing the right thing, but a far better one than showing nothing.
 * @param listing The decoded listing.
 * @param sourcePath The open source file.
 * @returns Returns the narrowed listing.
 */
export function filterToSource(listing: CodeListing, sourcePath: string): CodeListing {
  const known: readonly ListingSection[] = listing.sections.filter(
    (section: ListingSection): boolean => section.sourcePath !== undefined,
  );
  if (known.length === 0) {
    return listing;
  }
  const name: string = fileName(sourcePath);
  const matched: readonly ListingSection[] = listing.sections.filter(
    (section: ListingSection): boolean =>
      section.sourcePath !== undefined &&
      (samePath(section.sourcePath, sourcePath) || fileName(section.sourcePath) === name),
  );
  return { ...listing, sections: matched };
}

/**
 * Compares two paths for equality, tolerating separator and case differences.
 * @param left The first path.
 * @param right The second path.
 * @returns Returns true when they name the same file.
 */
function samePath(left: string, right: string): boolean {
  const normalise: (value: string) => string = (value: string): string =>
    value.replace(/\\/g, '/').toLowerCase();
  return normalise(left) === normalise(right);
}

/**
 * Gets a path's final segment.
 * @param value The path.
 * @returns Returns the file name.
 */
function fileName(value: string): string {
  const parts: readonly string[] = value.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? value;
}
