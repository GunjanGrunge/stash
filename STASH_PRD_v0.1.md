# STASH --- Product Requirements Document (PRD)

**Status:** Private Beta Definition\
**Version:** 0.1\
**Platform:** Windows + macOS\
**Cloud:** AWS-first\
**Initial Beta:** 2 users, 1 TB quota per user\
**Product category:** Creator-first cloud drive / virtual cloud storage

------------------------------------------------------------------------

## 1. Product Vision

**STASH is cloud storage built for creators.**

STASH gives creators a mounted cloud drive that follows them across
devices while preserving the exact file and folder structures they
already use. Users can **Stash** files and folders, reclaim local disk
space, search creator assets quickly, and drag assets directly into
their creative applications.

The product should feel closer to carrying a cloud SSD than using a
traditional upload/download website.

### Core promise

> **Stash it. Find it. Use it anywhere.**

STASH is not a chatbot, does not reorganize a user's library, and does
not require creators to adopt a proprietary folder structure.

------------------------------------------------------------------------

## 2. Problem

Creators accumulate large asset libraries across desktops, laptops and
external drives:

-   music samples, loops, one-shots, stems and MIDI
-   footage and B-roll
-   sound effects
-   LUTs and transitions
-   overlays and motion assets
-   images, logos and graphics
-   project resources and templates

Traditional cloud drives can store these files, but the creator workflow
still has friction:

1.  Large libraries consume local SSD space.
2.  Assets are difficult to find once collections become large.
3.  Creators already have meaningful folder structures that should not
    be destroyed.
4.  File names often contain useful metadata such as `Kick`, `G#`,
    `128BPM`, `4K`, `60FPS`, etc.
5.  A creator may work from multiple Windows/macOS machines.
6.  Re-uploading an existing sample pack or asset folder wastes storage
    and bandwidth.
7.  Creators want to drag assets into their existing applications rather
    than work inside a separate content-management system.

------------------------------------------------------------------------

## 3. Target Users

### Primary

Creators with large reusable asset libraries:

-   music producers
-   video editors
-   reel/short-form creators
-   content creators
-   motion designers
-   graphic designers
-   audio/video freelancers

### Private beta

Two users with up to **1 TB quota each**.

The beta should intentionally include different workflows so STASH is
validated as creator-first rather than music-only.

------------------------------------------------------------------------

## 4. Product Principles

### 4.1 Preserve the user's filesystem

If a user Stashes:

    KSHMR Vol 5/
    ├── Kicks/
    ├── Snares/
    └── Loops/

STASH must restore and display that exact hierarchy.

STASH must not silently rename, flatten, categorize, move or reorganize
user content.

### 4.2 File, Folder and Stash are different concepts

**File** --- an individual asset.

**Folder** --- part of the user's persistent filesystem hierarchy.

**Stash** --- a group of files/folders added during one ingestion event.

A Stash is metadata around an upload operation; it does not replace
folders.

### 4.3 Search metadata is not identity

Two assets with similar labels are not automatically duplicates.

For example:

    KSHMR Vol 4/Kicks/Kick_G#_128.wav
    KSHMR Vol 5/Kicks/Kick_G#_128.wav

must remain separate assets.

### 4.4 Cloud first, local when useful

Cloud-only assets should consume negligible local storage until
required. Frequently accessed or explicitly pinned assets may be cached
locally.

### 4.5 No unnecessary AI

STASH v1 should favor deterministic metadata extraction, tokenization,
aliases, structured filters and lexical ranking over LLMs.

------------------------------------------------------------------------

## 5. Core User Experience

### 5.1 Mounted drive

Windows:

    STASH (S:)

macOS:

    Locations
    └── STASH

Applications should be able to access files through normal filesystem
interactions where technically supported.

### 5.2 Stash It

The primary ingest action is **Stash it**, not Upload.

Users can:

-   click **Stash it**
-   select one or multiple files
-   select one or multiple folders
-   drag files/folders into STASH
-   Stash mixed selections in one operation

Example:

    Stashing 14,291 items · 42.6 GB

The original hierarchy must be retained.

### 5.3 File states

Recommended user-facing states:

-   **Cloud** --- stored remotely and not currently cached
-   **Available** --- cached locally
-   **Keep on this device** --- pinned for offline/local availability
-   **Stashing** --- upload in progress
-   **Syncing** --- metadata/file state updating
-   **Issue** --- requires retry or user attention

### 5.4 Free Up Space

A cached file can be evicted without deleting the cloud object.

The UI should say **Free up space**, not Delete, when the operation only
removes the local cached copy.

------------------------------------------------------------------------

## 6. Search

Search is a primary differentiator.

The search box should support both ordinary keywords and simple
creator-oriented structured expressions.

Examples:

    kick G# 120-130 bpm
    KSHMR kick 128
    vertical video under 30 sec
    4k footage 60fps
    warm LUT
    logo svg
    database assignment week 9 pdf

### 6.1 Search approach

Private beta should use:

1.  filename/path tokenization
2.  normalization
3.  synonym/alias mapping
4.  structured metadata filters
5.  TF-IDF or BM25-style lexical ranking
6.  exact/fuzzy token matching

An LLM/chatbot is explicitly **not required**.

### 6.2 Music metadata

Where discoverable from filename/path or inexpensive metadata
inspection:

-   asset type: kick, snare, clap, loop, vocal, MIDI, etc.
-   BPM
-   musical key
-   duration
-   sample rate
-   channels
-   format
-   pack/folder context

Normalize aliases such as:

    G# = G♯ = GSharp = G Sharp
    kicks = kick
    vox = vocal = vocals
    fx = sfx

### 6.3 Video metadata

-   resolution
-   width/height
-   orientation
-   frame rate
-   codec
-   duration
-   format
-   filename/path tokens

### 6.4 Image/graphic metadata

-   dimensions
-   orientation
-   format
-   filename/path tokens
-   safe/basic EXIF metadata where useful

### 6.5 General metadata

-   filename
-   original path
-   extension
-   MIME/media type
-   size
-   created/modified timestamps where preserved
-   checksum
-   parent folder
-   Stash ID
-   source device

------------------------------------------------------------------------

## 7. Duplicate Detection

Duplicate detection must not be based solely on filename, BPM, key,
labels or search metadata.

### Folder-level duplicate behavior

Before uploading a selected folder, the desktop client should generate a
local manifest containing:

-   relative paths
-   file sizes
-   file fingerprints/checksums
-   hierarchy information

The service compares this with existing folder manifests.

If an existing folder is effectively identical:

> **You already have this folder in STASH.**\
> `KSHMR Vol 5` --- 1,847 files · 4.2 GB · 100% match\
> **Cancel** \| **Stash anyway**

If an existing folder is mostly identical but contains new files:

> **KSHMR Vol 5 already exists.**\
> 1,847 of 1,850 files already Stashed.\
> **3 new files · 26 MB**\
> **Add new files** \| **Stash as separate copy** \| **Cancel**

The comparison should happen before unnecessary payload upload wherever
possible.

### Important rule

A matching content hash in a different legitimate pack/folder does
**not** automatically mean the user should lose one copy from their
logical filesystem.

Physical storage deduplication, if ever introduced, must be invisible
and must never alter the user's logical paths.

------------------------------------------------------------------------

## 8. Multi-Device Behavior

A user's STASH should be accessible from authorized Windows and macOS
devices.

Example:

    AWS STASH
       ├── Windows Desktop
       ├── MacBook
       └── Windows Laptop

Newly Stashed content should become visible on other authorized devices
after metadata synchronization.

Concurrent edits to the same file require explicit conflict handling.
STASH must never silently merge binary creator assets.

------------------------------------------------------------------------

## 9. Drag-and-Drop Behavior

When a cloud-only asset is dragged into another application:

1.  filesystem client receives read request
2.  local cache is checked
3.  if cached, serve locally
4.  if not cached, fetch from S3
5.  stage/cache locally
6.  expose readable file to application
7.  retain according to cache policy

Small creator assets should feel responsive after first retrieval;
cached access should approach local filesystem behavior.

The product must communicate network-dependent states instead of
pretending cloud latency does not exist.

------------------------------------------------------------------------

## 10. Caching

Private beta recommendation:

-   configurable local cache
-   initial default: approximately 20--50 GB depending on device
    capacity
-   LRU-style automatic eviction
-   pinned assets excluded from automatic eviction
-   partial/temporary download handling
-   safe cleanup of abandoned cache entries

Cache is both a UX optimization and an AWS egress/request cost
optimization.

------------------------------------------------------------------------

## 11. AWS-First Architecture

### Data plane

**Amazon S3** stores user payloads.

Large file transfers occur directly between the authorized desktop
client and S3 using short-lived authorization/presigned operations.

Large uploads use multipart upload.

### Control plane

Recommended beta stack:

-   **Amazon Cognito** --- identity/authentication
-   **Amazon API Gateway** --- application API
-   **AWS Lambda** --- serverless control logic
-   **Amazon DynamoDB** --- file/folder/Stash metadata
-   **Amazon S3** --- user file payloads
-   **Amazon CloudWatch** --- logging/metrics
-   **AWS Budgets** --- cost alerts

Initial deployment region: **ap-south-1 (Mumbai)**.

### Logical flow

    Windows/macOS STASH Client
              │
        Cognito Authentication
              │
          API Gateway
              │
            Lambda
         ┌────┴────┐
         │         │
     DynamoDB     S3 authorization
      Metadata      │
                    │
        Client ─────┴───── S3
          direct file transfer

### Storage model

S3 contains actual payloads.

DynamoDB contains logical metadata such as:

    user_id
    file_id
    folder_id
    stash_id
    object_key
    original_filename
    original_relative_path
    size
    media_type
    checksum
    created_at
    modified_at
    source_device
    search_tokens
    extracted_metadata

The implementation must not rely on S3 "folders" as if they were a full
filesystem. STASH maintains the logical filesystem model itself.

------------------------------------------------------------------------

## 12. Security Requirements

Private beta still uses production-minded security fundamentals:

-   S3 buckets private by default
-   no permanent AWS credentials distributed to clients
-   short-lived scoped access
-   least-privilege IAM
-   TLS for network transfers
-   encryption at rest
-   per-user authorization on every metadata/data operation
-   device/session revocation
-   audit logging for sensitive operations
-   safe handling of presigned access
-   server-side quota enforcement
-   no cross-user object access

------------------------------------------------------------------------

## 13. Reliability Requirements

STASH must safely handle:

-   network interruption
-   resumable/multipart uploads
-   individual part retries
-   failed downloads
-   incomplete local staging
-   app restart during Stashing
-   machine restart
-   temporary AWS/API failure
-   duplicate Stash attempts
-   metadata reconciliation
-   concurrent device activity

A failed transfer must not appear as successfully Stashed.

------------------------------------------------------------------------

## 14. Private Beta Scope

### Included

-   2 users
-   1 TB quota per user
-   Windows client
-   macOS client
-   STASH mounted location
-   Cognito authentication
-   Stash it
-   files + folders + mixed selection
-   folder hierarchy preservation
-   direct S3 transfer
-   multipart upload
-   local caching
-   cloud/local/pinned states
-   Free up space
-   deterministic duplicate-folder detection
-   creator metadata extraction
-   searchable metadata index
-   basic structured creator search
-   multi-device synchronization
-   transfer queue/progress
-   retry/error states
-   usage telemetry
-   AWS cost telemetry

### Explicitly out of scope for first private beta

-   chatbot
-   generative AI assistant
-   automatic reorganization of user files
-   collaborative document editing
-   public file-sharing marketplace
-   advanced video/audio semantic understanding
-   global multi-region replication
-   mobile filesystem client
-   enterprise administration
-   teams/workspaces
-   automatic destructive deduplication

------------------------------------------------------------------------

## 15. Beta Screens

The initial app design should cover at least:

1.  Welcome / Sign in
2.  STASH Home
3.  Main filesystem browser
4.  **Stash it** picker/drop zone
5.  Active Stash transfer/progress
6.  Duplicate folder warning
7.  Search + search results
8.  Asset details
9.  Recent Stashes/history
10. Storage & cache usage
11. Devices
12. Settings
13. Transfer/error recovery state
14. Offline/pinned assets

The desktop mounted-drive experience and the management app should feel
like one product.

------------------------------------------------------------------------

## 16. Dashboard Information Architecture

Recommended main navigation:

    STASH
    ├── Home
    ├── Files
    ├── Search
    ├── Recent Stashes
    ├── Offline
    ├── Transfers
    └── Settings

Persistent primary CTA:

    + Stash it

Persistent search:

    Search your STASH...

Storage indicator:

    624 GB of 1 TB

------------------------------------------------------------------------

## 17. Design Direction Requirements

The visual identity should be:

-   creator-first
-   premium
-   modern
-   fast
-   uncluttered
-   distinctive from enterprise file managers
-   usable in both light and dark environments
-   suitable for Windows and macOS
-   asset-centric rather than document-centric

Avoid:

-   generic AWS visual language
-   excessive gradients/glass effects that hurt readability
-   chatbot-style interfaces
-   crowded enterprise dashboards
-   cartoon cloud imagery
-   UI that resembles a web-only uploader

The **Stash it** interaction should be visually memorable enough to
become part of the brand.

------------------------------------------------------------------------

## 18. Beta Success Metrics

We should instrument the beta to answer:

### Product

-   successful Stash rate
-   upload resume success rate
-   average first-open latency
-   cached-open latency
-   search response time
-   search success/zero-result rate
-   duplicate-folder detections
-   cache hit rate
-   storage consumed per user
-   active devices per user

### AWS economics

-   S3 GB stored/user
-   GB uploaded/user
-   GB downloaded/user
-   S3 GET/PUT/LIST request counts
-   Lambda/API request counts
-   metadata storage/query cost
-   total AWS cost/user/month
-   cost per stored GB
-   egress per active user

The most important commercial beta output is:

> **Real monthly AWS cost per active 1 TB-quota STASH user.**

------------------------------------------------------------------------

## 19. Product Vocabulary

Use STASH terminology consistently.

  Generic term         STASH language
  -------------------- -----------------------
  Upload               **Stash it**
  Uploading            **Stashing**
  Uploaded             **Stashed**
  Upload batch         **Stash**
  Upload history       **Recent Stashes**
  Remove cached copy   **Free up space**
  Cloud drive          **STASH**
  Search               **Search your STASH**

Do not force branded language where it reduces clarity. Standard
concepts such as Files, Folders, Search, Settings and Devices should
remain familiar.

------------------------------------------------------------------------

## 20. Future Opportunities

After the core storage experience is proven:

-   creator-aware preview system
-   waveform previews
-   video thumbnails/contact sheets
-   richer audio analysis
-   richer video metadata
-   saved searches/smart collections
-   creator tags
-   shareable Stashes
-   team asset libraries
-   content-aware semantic search
-   optional lightweight AWS-hosted model for query interpretation
-   global acceleration/multi-region optimization
-   creator application integrations
-   mobile companion
-   usage-based or tiered subscription plans

These are extensions. They must not compromise the core promise of a
fast, predictable, filesystem-compatible creator cloud drive.

------------------------------------------------------------------------

## 21. Definition of Private Beta Done

Private beta is successful when both users can:

1.  install STASH on Windows/macOS;
2.  authenticate securely;
3.  Stash large existing folder trees without losing hierarchy;
4.  resume interrupted transfers;
5.  access the same logical library from another authorized device;
6.  search creator assets using useful filename/metadata queries;
7.  drag cloud assets into normal creator workflows;
8.  identify an already-Stashed folder before wasting bandwidth;
9.  pin assets locally and free cached space safely;
10. use the system for real creator work while we accurately measure
    latency, reliability and AWS cost.

------------------------------------------------------------------------

# Working Product Statement

**STASH is a creator-first cloud drive that preserves your library
exactly as you built it, makes your assets searchable, and keeps them
available across your devices without requiring the entire library to
live on every SSD.**

**Stash it. Find it. Use it anywhere.**
