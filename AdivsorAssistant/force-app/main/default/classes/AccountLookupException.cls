/**
 * Thrown by AccountLookupService for conditions the end user is allowed to see:
 * missing permission, a search term that is too short, an account that does not exist.
 *
 * AccountLookupController catches this type specifically and passes its message through
 * to the LWC unchanged. Every other exception is swallowed and replaced with a generic
 * message, so anything a user should read must be thrown as this type.
 */
public class AccountLookupException extends Exception {}
